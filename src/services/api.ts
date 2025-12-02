// Dummy API service layer
// Backend developers: Replace these endpoints with real API calls

const PINEAPPLE_API_BASE = 'https://dummy.pineapple.ai';

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const api = {
  onboarding: {
    start: async () => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/start`);
      return { success: true };
    },
    
    setUserName: async (name: string) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/user-name`, { user_name: name });
      return { success: true };
    },
    
    setCommunicationMode: async (mode: string) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/communication-mode`, { mode });
      return { success: true };
    },
    
    setDailyStructure: async (structure: string) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/daily-structure`, { structure });
      return { success: true };
    },
    
    setPriorityDomains: async (domains: string[]) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/priority-domains`, { domains });
      return { success: true };
    },
    
    setExistingSystems: async (systems: string[]) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/existing-systems`, { systems });
      return { success: true };
    },
    
    setInsightStyle: async (style: string) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/insight-style`, { style });
      return { success: true };
    },
    
    setLocation: async (location: string) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/location`, { location });
      return { success: true };
    },
    
    connect: async (type: string) => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/connect`, { type });
      return { success: true };
    },
    
    complete: async () => {
      await delay(500);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/onboarding/complete`);
      return { success: true };
    },
  },
  
  chat: {
    send: async (message: string, userName?: string, orbName?: string) => {
      await delay(800);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/chat`, { 
        user_name: userName,
        orb_name: orbName,
        message 
      });
      return {
        response: "Analysis complete. Data has been processed.",
        success: true
      };
    },
    
    quick: async (intent: string) => {
      await delay(800);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/quick`, { intent });
      return {
        response: `Quick action response for: ${intent}`,
        success: true
      };
    },
    
    action: async (action: string, context?: string) => {
      await delay(800);
      console.log(`API: POST ${PINEAPPLE_API_BASE}/action`, { action, context });
      return {
        response: `Action response for: ${action}`,
        success: true
      };
    },
  },
};
