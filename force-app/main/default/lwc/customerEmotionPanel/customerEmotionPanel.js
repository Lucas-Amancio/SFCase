import analyzeAndPersist from '@salesforce/apex/CustomerEmotionController.analyzeAndPersist';
import { subscribe, APPLICATION_SCOPE, MessageContext } from 'lightning/messageService';
import getPanelConfig from '@salesforce/apex/CustomerEmotionController.getPanelConfig';
import ConversationEndUserChannel from '@salesforce/messageChannel/lightning__conversationEndUserMessage';
import ConversationEndedChannel from '@salesforce/messageChannel/lightning__conversationEnded';
import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';

const LAST_EMOTION_FIELD = 'MessagingSession.LastEmotion__c';
const LAST_EMOTION_REASON_FIELD = 'MessagingSession.LastEmotionReason__c';


export default class CustomerEmotionPanel extends LightningElement {
    @api recordId;
    
    emotion;
    reason;
    error;
    loaded = false;             
    receivingSubscription;      // subscription for end-user messages
    endedSubscription;          // subscription for conversation end events
    messages;
    conversationEnded = false;
    _analyzing = false;          // in-flight flag
    
    @wire(MessageContext) messageContext;
    
    _subscribeAttempts = 0;
    _subscribedLogged = false;
    _configLoaded = false;
    config = { calculateEveryMessage: false, calculateOnSessionEnd: false, showCalculateButton: false };
    
    _toolkitReady = false;
    _initialConversationFetched = false;
    _fetchAttempts = 0;
    MAX_FETCH_ATTEMPTS = 5;

    @wire(getPanelConfig) wiredConfig({ data, error }) {
        if (data) {
            this.config = {
                calculateEveryMessage: !!data.calculateEveryMessage,
                calculateOnSessionEnd: !!data.calculateOnSessionEnd,
                showCalculateButton: !!data.showCalculateButton
            };
            this._configLoaded = true;

            if (this.messages && this.config.calculateEveryMessage && !this._analyzing && !this.hasResult) {
                this.runAnalysis();
            }
        } else if (error) {
            console.warn('[EmotionPanel] Config wire error', error?.body?.message || error.message);
            this._configLoaded = true;
        }
    }

    @wire(getRecord, { recordId: '$recordId', fields: [LAST_EMOTION_FIELD, LAST_EMOTION_REASON_FIELD] })
    wiredSession(resp) {
        const { error, data } = resp;
        if (data) {
            if (!this.emotion) {
                const persistedEmotion = getFieldValue(data, LAST_EMOTION_FIELD);
                const persistedReason = getFieldValue(data, LAST_EMOTION_REASON_FIELD);
                if (persistedEmotion) {
                    this.emotion = String(persistedEmotion).toLowerCase();
                    this.reason = persistedReason;
                    this.loaded = true;
                    console.log('[EmotionPanel] Seeded from persisted fields');
                }
            }
        } else if (error) {
            console.warn('[EmotionPanel] Could not load persisted emotion', error?.body?.message || error.message);
        }
    }

    connectedCallback() {
        console.log('[EmotionPanel] connectedCallback');
        this.trySubscribe();
        this.loaded = true; 
    }

    get toolkit() {
        return this.refs?.lwcToolKitApi;
    }
    
    renderedCallback() {
        if (!this._toolkitReady && this.toolkit && this.recordId) {
            this._toolkitReady = true;
            this.tryInitialFetch();
        }
    }

    tryInitialFetch() {
        this.fetchFullConversation().then(got => {
            if (got) {
                this._initialConversationFetched = true;
            } else if (this._fetchAttempts < this.MAX_FETCH_ATTEMPTS) {
                this._fetchAttempts++;
                // retry with small backoff (e.g., 300ms * attempt number)
                setTimeout(() => this.tryInitialFetch(), 300 * this._fetchAttempts);
            }
        });
    }

    trySubscribe() {

        try {
            if (!this.receivingSubscription) {
                this.receivingSubscription = subscribe(
                    this.messageContext,
                    ConversationEndUserChannel,
                    (message) => this.handleMessageReceived(message),
                    { scope: APPLICATION_SCOPE }
                );
                console.log('[EmotionPanel] Subscribed to lightning__conversationEndUserMessage', this.receivingSubscription);
            }
            if (!this.endedSubscription) {
                this.endedSubscription = subscribe(
                    this.messageContext,
                    ConversationEndedChannel,
                    (payload) => this.handleConversationEnded(payload),
                    { scope: APPLICATION_SCOPE }
                );
                console.log('[EmotionPanel] Subscribed to lightning__conversationEnded', this.endedSubscription);
            }
        } catch (e) {
            console.error('[EmotionPanel] Subscription error', e);
        }
    }

    async handleMessageReceived(message) {
        console.log('[EmotionPanel] Inbound conversation message payload raw:', message);
        
        this.messages = JSON.stringify(message?.content);
        
        if (this.messages) {
            await this.runAnalysis({ context: 'message' });
        }
    }

    async handleConversationEnded(payload) {
        console.log('[EmotionPanel] Conversation ended payload:', payload);
        this.conversationEnded = true;
        
        await this.fetchFullConversation();
        if (!this.hasResult && this.messages) {
            await this.runAnalysis({ context: 'end' });
        }
    }

    async runAnalysis({ force = false, context = 'manual', overrideText } = {}) {
        const text = (overrideText || this.messages || '').trim();
        if (!text) {
            this.loaded = true;
            return null;
        }
        if (!force) {
            if (context === 'message' && !this.config.calculateEveryMessage) {
                return null;
            }
            if (context === 'end' && !this.config.calculateOnSessionEnd) {
                return null;
            }
        }
        if (this._analyzing) {
            return null;
        }
        this._analyzing = true;
        this.loaded = false;
        this.error = null;
        console.log('[EmotionPanel] Analyzing text:', text);
        let result = null;

        try {
            let resp = await analyzeAndPersist({ sessionId: this.recordId, text });
            if (typeof resp === 'string') {
                resp = JSON.parse(resp);
            }
            this.emotion = (resp?.emotion || '').toLowerCase();
            this.reason = resp?.reason;
            result = { emotion: this.emotion, reason: this.reason, raw: resp?.raw || resp };
            console.log('[EmotionPanel] Analysis result:', result);

        } catch (e) {
            this.error = e?.body?.message || e.message || 'Error analyzing sentiment';

        } finally {
            this.loaded = true;
            this._analyzing = false;
        }
        return result;
    }

    async handleManualCalculate() {
        if (!this.messages) {
            this.error = 'No message text to analyze yet.';
            return;
        }
        await this.runAnalysis({ force: true, context: 'manual' });
    }

    get showCalculateButton() { return this.config.showCalculateButton; }

    get hasResult() { return !!this.emotion; }

    get displayEmotion() {
        if (!this.emotion) return '';
        return this.emotion.charAt(0).toUpperCase() + this.emotion.slice(1);
    }
    get iconName() {
        switch (this.emotion) {
            case 'positive': return 'utility:emoji_good';
            case 'negative': return 'utility:emoji_worst';
            case 'neutral': return 'utility:emoji_above_average';
            default: return 'utility:help';
        }
    }
    get badgeClass() {
        const base = 'slds-badge';
        switch (this.emotion) {
            case 'positive': return `${base} slds-theme_success`;
            case 'negative': return `${base} slds-theme_error`;
            case 'neutral': return `${base} slds-theme_info`;
            default: return base;
        }
    }
    async fetchFullConversation() {
        if (!this.toolkit || !this.recordId) return false;
        
        try {
            let log = await this.toolkit.getConversationLog(this.recordId);
            console.log(`[EmotionPanel] Fetched full raw `, JSON.stringify(log));
            const raw = log?.messages || [];

            if (!raw.length) return false;
            
            const messageLog = [];
            raw.forEach(m => {
                messageLog.push({
                    content: m.content,
                    author: m.name || 'Unknown'
                });
            });

            this.messages = JSON.stringify(messageLog);
            
            await this.runAnalysis({ context: 'end' });
            return true;
        } catch (e) {
            console.warn('[EmotionPanel] fetchFullConversation failed', e?.body?.message || e.message);
            return false;
        }
    }
}