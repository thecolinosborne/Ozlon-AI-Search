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
    
    getWowMoment: async (connectedApp: string) => {
      await delay(700);
      console.log('API: GET /onboarding/wow', { connectedApp });
      
      const insights: Record<string, string[]> = {
        bank: [
          "You spent a bit more than usual on food this week. Want me to help you keep an eye on that?",
          "You have a bill due in 3 days. Want a reminder?",
          "Your rent payment is coming up. Want me to make sure you don't miss it?"
        ],
        email: [
          "You have an important email you haven't opened yet. Want me to bring it to the top?",
          "There's a message about your benefits that needs attention. Want to see it?",
          "Someone sent you something time-sensitive. Want me to show you?"
        ],
        calendar: [
          "You have something coming up soon. Want a reminder 24 hours before?",
          "Your schedule looks busy tomorrow. Want me to help you prepare?",
          "You have an appointment next week. Want me to keep you on track?"
        ],
        none: [
          "Your city has free meals available today. Want directions?",
          "A local job fair is coming up soon. Want the details?",
          "Voting day is next week in your area. Want a reminder?"
        ]
      };
      
      const appInsights = insights[connectedApp] || insights.none;
      return {
        insight: appInsights[Math.floor(Math.random() * appInsights.length)],
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
