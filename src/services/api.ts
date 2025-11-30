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
    
    setUserName: async (name: string) => {
      await delay(500);
      console.log('API: POST /onboarding/user-name', { user_name: name });
      return { success: true };
    },
    
    setAIName: async (name: string) => {
      await delay(500);
      console.log('API: POST /onboarding/ai-name', { assistant_name: name });
      return { success: true };
    },
    
    nameConfirmed: async () => {
      await delay(500);
      console.log('API: POST /onboarding/name-confirmed');
      return { success: true };
    },
    
    setLocation: async (location: string) => {
      await delay(500);
      console.log('API: POST /onboarding/location', { location });
      return { success: true };
    },
    
    connect: async (type: string) => {
      await delay(500);
      console.log('API: POST /onboarding/connect', { type });
      return { success: true };
    },
    
    setMainConcern: async (concern: string) => {
      await delay(500);
      console.log('API: POST /onboarding/main-concern', { concern });
      return { success: true };
    },
    
    getInsight: async () => {
      await delay(700);
      console.log('API: GET /onboarding/insight');
      const insights = [
        "Your city has free meals available nearby today.",
        "A local job fair is coming up soon.",
        "Voting day is next week in your area."
      ];
      return {
        insight: insights[Math.floor(Math.random() * insights.length)],
        success: true
      };
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
