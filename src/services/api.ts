// Dummy API service layer
// Backend developers: Replace these endpoints with real API calls

const DUMMY_API_BASE = 'https://dummy.ozlon.ai';

// Simulate network delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const api = {
  onboarding: {
    start: async () => {
      await delay(500);
      console.log('API: POST /onboarding/start');
      return { success: true };
    },
    
    setName: async (name: string) => {
      await delay(500);
      console.log('API: POST /onboarding/name', { name });
      return { success: true };
    },
    
    setLocation: async (location: string) => {
      await delay(500);
      console.log('API: POST /onboarding/location', { location });
      return { success: true };
    },
    
    setMainNeed: async (need: string) => {
      await delay(500);
      console.log('API: POST /onboarding/mainneed', { need });
      return { success: true };
    },
    
    selectConnection: async (connection: string) => {
      await delay(500);
      console.log('API: POST /onboarding/connection-selected', { connection });
      return { success: true };
    },
    
    connect: async (service: string) => {
      await delay(1000);
      console.log('API: POST /onboarding/connect', { service });
      return { success: true };
    },
    
    getInsight: async () => {
      await delay(700);
      console.log('API: GET /onboarding/insight');
      return {
        insight: "Local voting deadline is in 12 days. Want a reminder?",
        success: true
      };
    },
    
    setCategory: async (category: string) => {
      await delay(500);
      console.log('API: POST /onboarding/category', { category });
      return { success: true };
    },
    
    complete: async () => {
      await delay(500);
      console.log('API: POST /onboarding/complete');
      return { success: true };
    },
  },
  
  chat: {
    send: async (message: string) => {
      await delay(800);
      console.log('API: POST /chat', { message });
      return {
        response: "I'm here to help! This is a placeholder response.",
        success: true
      };
    },
  },
};
