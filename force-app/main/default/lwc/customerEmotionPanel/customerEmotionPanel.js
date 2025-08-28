import analyze from '@salesforce/apex/CustomerEmotionController.analyze';
import { subscribe, APPLICATION_SCOPE, MessageContext } from 'lightning/messageService';
import ConversationEndUserChannel from '@salesforce/messageChannel/lightning__conversationEndUserMessage';
import ConversationEndedChannel from '@salesforce/messageChannel/lightning__conversationEnded';
import { LightningElement, api, wire } from 'lwc';


export default class CustomerEmotionPanel extends LightningElement {
    @api recordId;

    emotion;
    reason;
    error;
    loaded = false;              // true when UI ready (after analysis or no data)
    receivingSubscription;      // subscription for end-user messages
    endedSubscription;          // subscription for conversation end events
    messages;
    conversationEnded = false;
    _analyzing = false;          // in-flight flag

    @wire(MessageContext) messageContext;

    _subscribeAttempts = 0;
    _subscribedLogged = false;

    connectedCallback() {
        console.log('[EmotionPanel] connectedCallback');
        this.trySubscribe();
        this.loaded = true; // placeholder until first message
    }

    renderedCallback() {
        // In case wire becomes available only after first render, retry
        if (!this.receivingSubscription) {
            this.trySubscribe();
        }
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
        // Attempt to extract a plain text field. Adjust depending on actual payload structure.
        let extracted;
        // Common shapes to probe
        extracted = extracted || message?.content?.messageText; // some conversation payloads
        extracted = extracted || message?.content?.text;        // alternative key
        extracted = extracted || message?.content;              // raw content primitive
        extracted = extracted || message?.messageText;          // direct field
        // Fallback: stringify minimal subset
        if (!extracted && message?.content) {
            extracted = JSON.stringify(message.content);
        }
        if (!extracted) return; // nothing usable
        this.messages = String(extracted).trim();
        await this.runAnalysis();
    }

    async handleConversationEnded(payload) {
        console.log('[EmotionPanel] Conversation ended payload:', payload);
        this.conversationEnded = true;
        await this.runAnalysis();
    }

    // Helper for manual testing: call from console after selecting component DOM: cmp.simulateMessage('hello world')
    @api async simulateMessage(text) {
        return await this.handleMessageReceived({ content: text });
    }

    /**
     * Performs analysis of current this.messages.
     * Returns a result object { emotion, reason, raw } or null if nothing to analyze.
     */
    async runAnalysis() {
        const text = (this.messages || '').trim();
        if (!text) {
            this.loaded = true;
            return null;
        }
        if (this._analyzing) {
            // Avoid overlapping calls; let the in-flight one finish.
            return null;
        }
        this._analyzing = true;
        this.loaded = false;
        this.error = null;
        console.log('[EmotionPanel] Analyzing text:', text);
        let result = null;
        try {
            let resp = await analyze({ text });
            if (typeof resp === 'string') {
                try { resp = JSON.parse(resp); } catch (_) { /* ignore */ }
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
        // If no current text, prompt user (could extend to open modal etc.)
        if (!this.messages) {
            this.error = 'No message text to analyze yet.';
            return;
        }
        await this.runAnalysis();
    }

    // Removed loadConfig & dynamic button visibility
    get showCalculateButton() { return true; }

    get hasResult() { return !!this.emotion; }
    get iconName() {
        switch (this.emotion) {
            case 'positive': return 'utility:smiley_and_people';
            case 'negative': return 'utility:dislike';
            case 'neutral': return 'utility:minus';
            default: return 'utility:question';
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
}