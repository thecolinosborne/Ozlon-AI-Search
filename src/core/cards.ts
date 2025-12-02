// ============================================
// OZLON ORB OS - DEFAULT DASHBOARD CARDS
// ============================================
// Card configurations for the living dashboard.

import { registerCard } from "./registry";
import type { CardConfig } from "./types";

// ============================================
// TIME ENGINE CARDS
// ============================================

const timeCards: CardConfig[] = [
  {
    id: "time-today-schedule",
    name: "Today's Schedule",
    description: "Your meetings and events for today",
    category: "time",
    component: "TodayScheduleCard",
    size: "medium",
    priority: 1,
    enabled: true,
    refreshInterval: 300000, // 5 minutes
    dataSource: "fetch-calendar",
  },
  {
    id: "time-tasks-due",
    name: "Tasks Due",
    description: "Tasks that need your attention",
    category: "time",
    component: "TasksDueCard",
    size: "medium",
    priority: 2,
    enabled: true,
    refreshInterval: 300000,
    dataSource: "fetch-tasks",
  },
  {
    id: "time-smart-suggestions",
    name: "Smart Suggestions",
    description: "AI-powered scheduling suggestions",
    category: "time",
    component: "SmartSuggestionsCard",
    size: "small",
    priority: 3,
    enabled: true,
    dataSource: "scheduling-agent",
  },
];

// ============================================
// MONEY ENGINE CARDS
// ============================================

const moneyCards: CardConfig[] = [
  {
    id: "money-spending",
    name: "Spending Overview",
    description: "Your spending this period",
    category: "money",
    component: "SpendingCard",
    size: "medium",
    priority: 1,
    enabled: true,
    refreshInterval: 3600000, // 1 hour
    dataSource: "fetch-transactions",
  },
  {
    id: "money-upcoming-bills",
    name: "Upcoming Bills",
    description: "Bills and subscriptions due soon",
    category: "money",
    component: "UpcomingBillsCard",
    size: "small",
    priority: 2,
    enabled: true,
    dataSource: "fetch-bills",
  },
  {
    id: "money-subscriptions",
    name: "Subscription Warnings",
    description: "Subscription renewal alerts",
    category: "money",
    component: "SubscriptionWarningsCard",
    size: "small",
    priority: 3,
    enabled: true,
    dataSource: "finance-agent",
  },
];

// ============================================
// HEALTH ENGINE CARDS
// ============================================

const healthCards: CardConfig[] = [
  {
    id: "health-sleep",
    name: "Sleep",
    description: "Your sleep patterns",
    category: "health",
    component: "SleepCard",
    size: "small",
    priority: 1,
    enabled: false,
    dataSource: "process-wearable-data",
  },
  {
    id: "health-steps",
    name: "Activity",
    description: "Steps and movement",
    category: "health",
    component: "StepsCard",
    size: "small",
    priority: 2,
    enabled: false,
    dataSource: "process-wearable-data",
  },
  {
    id: "health-stress",
    name: "Stress Indicators",
    description: "Stress level insights",
    category: "health",
    component: "StressCard",
    size: "small",
    priority: 3,
    enabled: false,
    dataSource: "health-agent",
  },
];

// ============================================
// RELATIONSHIP ENGINE CARDS
// ============================================

const relationshipCards: CardConfig[] = [
  {
    id: "relationship-contacts",
    name: "Important Contacts",
    description: "People you interact with most",
    category: "relationship",
    component: "ContactsCard",
    size: "medium",
    priority: 1,
    enabled: false,
    dataSource: "fetch-contacts",
  },
  {
    id: "relationship-birthdays",
    name: "Upcoming Birthdays",
    description: "Birthdays this week",
    category: "relationship",
    component: "BirthdaysCard",
    size: "small",
    priority: 2,
    enabled: false,
    dataSource: "relationship-agent",
  },
  {
    id: "relationship-social",
    name: "Social Insights",
    description: "Communication patterns",
    category: "relationship",
    component: "SocialInsightsCard",
    size: "small",
    priority: 3,
    enabled: false,
    dataSource: "relationship-agent",
  },
];

// ============================================
// KNOWLEDGE ENGINE CARDS
// ============================================

const knowledgeCards: CardConfig[] = [
  {
    id: "knowledge-recent",
    name: "Recent Reads",
    description: "Documents you've accessed",
    category: "knowledge",
    component: "RecentReadsCard",
    size: "medium",
    priority: 1,
    enabled: true,
    dataSource: "fetch-notes",
  },
  {
    id: "knowledge-memory",
    name: "Memory Graph",
    description: "Your knowledge connections",
    category: "knowledge",
    component: "MemoryGraphCard",
    size: "large",
    priority: 2,
    enabled: false,
    dataSource: "memory-agent",
  },
  {
    id: "knowledge-summaries",
    name: "Document Summaries",
    description: "AI summaries of your documents",
    category: "knowledge",
    component: "DocumentSummariesCard",
    size: "medium",
    priority: 3,
    enabled: true,
    dataSource: "knowledge-agent",
  },
];

// ============================================
// OPPORTUNITY RADAR CARDS
// ============================================

const opportunityCards: CardConfig[] = [
  {
    id: "opportunity-calendar-slots",
    name: "Free Slots",
    description: "Available time for deep work",
    category: "opportunity",
    component: "FreeSlotsCard",
    size: "small",
    priority: 1,
    enabled: true,
    dataSource: "scheduling-agent",
  },
  {
    id: "opportunity-savings",
    name: "Money-Saving Insights",
    description: "Ways to save money",
    category: "opportunity",
    component: "SavingsInsightsCard",
    size: "small",
    priority: 2,
    enabled: true,
    dataSource: "finance-agent",
  },
  {
    id: "opportunity-weak-signals",
    name: "Weak Signals",
    description: "Emerging opportunities",
    category: "opportunity",
    component: "WeakSignalsCard",
    size: "medium",
    priority: 3,
    enabled: true,
    dataSource: "opportunity-agent",
  },
];

// ============================================
// REGISTER ALL CARDS
// ============================================

export function registerDefaultCards(): void {
  const allCards = [
    ...timeCards,
    ...moneyCards,
    ...healthCards,
    ...relationshipCards,
    ...knowledgeCards,
    ...opportunityCards,
  ];

  allCards.forEach(registerCard);
  console.log(`[Cards] ${allCards.length} default cards registered`);
}
