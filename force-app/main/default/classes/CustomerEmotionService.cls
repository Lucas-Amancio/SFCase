public with sharing class CustomerEmotionService {
    public class NoGenerationResponseException extends Exception {}
    public class InvalidModelOutputException extends Exception {}

    private static final String TEMPLATE_API_NAME = 'CustomerEmotionAnalysis';
    private static final String APPLICATION_NAME = 'PromptTemplateGenerationsInvocable';
    private static final String INPUT_KEY = 'Input:MessageText';

    public static CustomerEmotionResponse analyzeEmotion(String messages) {
        if (String.isBlank(messages)) {
            throw new IllegalArgumentException('messages cannot be blank');
        }

        Map<String, Object> inputValues = new Map<String, Object>{
            INPUT_KEY => messages
        };

        ConnectApi.EinsteinPromptTemplateGenerationsRepresentation generationOutput =
            getEmotion(inputValues, APPLICATION_NAME, TEMPLATE_API_NAME);

        if (generationOutput.generations == null || generationOutput.generations.isEmpty()) {
            System.debug(LoggingLevel.WARN, 'No generations returned.');
            throw new NoGenerationResponseException('No generation returned');
        }

        String rawText = generationOutput.generations[0].text;
        CustomerEmotionResponse sr;
        try {
            sr = (CustomerEmotionResponse) JSON.deserialize(rawText, CustomerEmotionResponse.class);
        } catch (Exception e) {
            System.debug(LoggingLevel.ERROR, 'Failed to parse model JSON: ' + e.getMessage());
            throw new InvalidModelOutputException('Model output not valid JSON for CustomerEmotionResponse');
        }
        sr.raw = rawText;
        return sr;
    }

    private static ConnectApi.EinsteinPromptTemplateGenerationsRepresentation getEmotion(
        Map<String, Object> inputValues,
        String applicationName,
        String templateAPIName
    ){
        ConnectApi.EinsteinPromptTemplateGenerationsInput promptGenerationInput =
            new ConnectApi.EinsteinPromptTemplateGenerationsInput();
        promptGenerationInput.isPreview = false;

        Map<String, ConnectApi.WrappedValue> valueMap = new Map<String, ConnectApi.WrappedValue>();
        for (String inputName : inputValues.keySet()) {
            ConnectApi.WrappedValue w = new ConnectApi.WrappedValue();
            w.value = inputValues.get(inputName);
            valueMap.put(inputName, w);
        }
        promptGenerationInput.inputParams = valueMap;

        promptGenerationInput.additionalConfig = new ConnectApi.EinsteinLlmAdditionalConfigInput();
        promptGenerationInput.additionalConfig.applicationName = applicationName;

        return ConnectApi.EinsteinLLM.generateMessagesForPromptTemplate(templateAPIName, promptGenerationInput);
    }
}
