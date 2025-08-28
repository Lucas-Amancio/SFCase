public without sharing class CustomerEmotionController {

    // Simple config envelope (used instead of separate config controller)
    // public class ConfigEnvelope {
    //     @AuraEnabled public Boolean success;
    //     @AuraEnabled public String value; // JSON of flags
    //     @AuraEnabled public String error;
    // }

    private static final String TEMPLATE_API_NAME = 'CustomerEmotionAnalysis';
    private static final String APPLICATION_NAME = 'PromptTemplateGenerationsInvocable';
    private static final String INPUT_KEY = 'Input:MessageText';

    // @AuraEnabled(cacheable=true)
    // public static PanelConfigDTO getPanelConfig() {
    //     // Expect a single metadata record with DeveloperName 'Default' (adjust if needed)
    //     PanelConfigDTO dto = new PanelConfigDTO();
    //     try {
    //         // Use getAll to avoid query limits and then pick first if 'Default' not found
    //         Map<String, EmotionPanelConfiguration__mdt> all = EmotionPanelConfiguration__mdt.getAll();
    //         EmotionPanelConfiguration__mdt rec;
    //         if (all.containsKey('Default')) {
    //             rec = all.get('Default');
    //         } else if (!all.isEmpty()) {
    //             rec = all.values()[0];
    //         }
    //         if (rec != null) {
    //             dto.calculateEveryMessage = rec.CalculateEmotionEveryMessage__c;
    //             dto.calculateOnSessionEnd = rec.CalculateEmotionSessionEnd__c;
    //             dto.showCalculateButton = rec.ShowCalculateButton__c;
    //         }
    //     } catch (Exception ex) {
    //         // Swallow—return dto with nulls (LWC can default false)
    //     }
    //     return dto;
    // }

    @AuraEnabled(cacheable=true)
    public static CustomerEmotionResponse analyze(String text) {
        if (String.isBlank(text)) {
            throw new AuraHandledException('Text cannot be blank');
        }
        CustomerEmotionResponse resp = new CustomerEmotionResponse();
        // try {
            String raw = generate(text);
            System.debug('Generated raw response: ' + raw);
            // Attempt to parse JSON first
            CustomerEmotionResponse parsed = (CustomerEmotionResponse) JSON.deserialize(raw, CustomerEmotionResponse.class);
            resp.emotion = parsed.emotion;
            resp.reason = parsed.reason;
            resp.raw = raw;
            System.debug('Parsed response: ' + JSON.serialize(resp));
        // } catch (Exception e) {
        //     // Surface controlled error to LWC
        //     throw new AuraHandledException('Emotion analysis failed: ' + e.getMessage());
        // }

        return resp;
    }

    // @AuraEnabled(cacheable=true)
    // public static String getComponentDefinitions() {
    //     ConfigEnvelope env = new ConfigEnvelope();
    //     try {
    //         Map<String,Object> flags = new Map<String,Object>();
    //         // Hard-coded defaults; replace with Custom Metadata if desired.
    //         flags.put('ComponentEnabled__c', true);
    //         flags.put('CalculateemotionButtonClick__c', true);
    //         flags.put('CalculateemotionConversationEnd__c', true);
    //         flags.put('CalculateemotionEveryMessage__c', false);
    //         env.success = true;
    //         env.value = JSON.serialize(flags);
    //     } catch (Exception ex) {
    //         env.success = false;
    //         env.error = ex.getMessage();
    //     }
    //     return JSON.serialize(env);
    // }

    // --- Helpers ---
    private static String generate(String messages) {
        // Build input
        ConnectApi.EinsteinPromptTemplateGenerationsInput input = new ConnectApi.EinsteinPromptTemplateGenerationsInput();
        input.isPreview = false;
        Map<String, ConnectApi.WrappedValue> params = new Map<String, ConnectApi.WrappedValue>();
        ConnectApi.WrappedValue w = new ConnectApi.WrappedValue();
        w.value = messages;
        params.put(INPUT_KEY, w);
        input.inputParams = params;
        input.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
        input.additionalConfig.applicationName = APPLICATION_NAME;

        ConnectApi.EinsteinPromptTemplateGenerationsRepresentation out = ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(TEMPLATE_API_NAME, input);
        if (out.generations == null || out.generations.isEmpty()) {
            throw new AuraHandledException('No generations returned by model');
        }
        return out.generations[0].text;
    }

}
