public without sharing class CustomerEmotionController {

    private static final String TEMPLATE_API_NAME = 'CustomerEmotionAnalysis';
    private static final String APPLICATION_NAME = 'PromptTemplateGenerationsInvocable';
    private static final String INPUT_KEY = 'Input:MessageText';

    @AuraEnabled(cacheable=true)
    public static PanelConfigDTO getPanelConfig() {
        PanelConfigDTO dto = new PanelConfigDTO();
        try {
            Map<String, EmotionPanelConfiguration__mdt> all = EmotionPanelConfiguration__mdt.getAll();
            EmotionPanelConfiguration__mdt rec;
            rec = all.get('Default');
            
            if (rec == null && !all.isEmpty()) {
                rec = all.values()[0];
            }

            if (rec != null) {
                dto.calculateEveryMessage = rec.CalculateEmotionEveryMessage__c;
                dto.calculateOnSessionEnd = rec.CalculateEmotionSessionEnd__c;
                dto.showCalculateButton = rec.ShowCalculateButton__c;
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'Error loading panel config: ' + ex.getMessage());
        }
        return dto;
    }

    private static CustomerEmotionResponse analyzeInternal(String text) {
        if (String.isBlank(text)) {
            throw new AuraHandledException('Text cannot be blank');
        }
        CustomerEmotionResponse resp = new CustomerEmotionResponse();
        String raw = generate(text);

        try {
            CustomerEmotionResponse parsed = (CustomerEmotionResponse) JSON.deserialize(raw, CustomerEmotionResponse.class);
            resp.emotion = parsed.emotion;
            resp.reason = parsed.reason;
        } catch (Exception parseEx) {
            resp.emotion = 'unknown';
            resp.reason = raw;
        }
        resp.raw = raw;
        System.debug('Parsed response: ' + JSON.serialize(resp));
        return resp;
    }


    @AuraEnabled
    public static CustomerEmotionResponse analyze(String text) {
        return analyzeInternal(text);
    }


    @AuraEnabled
    public static CustomerEmotionResponse analyzeAndPersist(Id sessionId, String text) {
        CustomerEmotionResponse resp = analyzeInternal(text);
        if (sessionId == null) {
            return resp; 
        }
        try {
            Schema.SObjectType msType = Schema.getGlobalDescribe().get('MessagingSession');
            if (msType != null) {
                Map<String, Schema.SObjectField> fMap = msType.getDescribe().fields.getMap();
                Boolean hasEmotion = fMap.containsKey('LastEmotion__c');
                Boolean hasReason = fMap.containsKey('LastEmotionReason__c');
                Boolean hasUpdated = fMap.containsKey('LastEmotionUpdated__c');
                if (hasEmotion || hasReason || hasUpdated) {
                    SObject ms = msType.newSObject();
                    ms.put('Id', sessionId);
                    if (hasEmotion) ms.put('LastEmotion__c', resp.emotion);
                    if (hasReason) ms.put('LastEmotionReason__c', resp.reason);
                    if (hasUpdated) ms.put('LastEmotionUpdated__c', System.now());
                    update ms;
                }
            }
        } catch (Exception ex) {
            System.debug(LoggingLevel.WARN, 'Emotion persistence skipped: ' + ex.getMessage());
        }
        return resp;
    }

    private static String generate(String messages) {
        ConnectApi.EinsteinPromptTemplateGenerationsInput input = new ConnectApi.EinsteinPromptTemplateGenerationsInput();
        Map<String, ConnectApi.WrappedValue> params = new Map<String, ConnectApi.WrappedValue>();
        ConnectApi.WrappedValue w = new ConnectApi.WrappedValue();

        w.value = messages;
        params.put(INPUT_KEY, w);

        input.isPreview = false;
        input.inputParams = params;
        input.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
        input.additionalConfig.applicationName = APPLICATION_NAME;

        ConnectApi.EinsteinPromptTemplateGenerationsRepresentation out = ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(TEMPLATE_API_NAME, input);
        if (out.generations == null || out.generations.isEmpty()) {
            throw new AuraHandledException('Nothing generated');
        }
        return out.generations[0].text;
    }

}
