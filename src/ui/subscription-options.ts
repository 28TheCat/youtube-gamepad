export const subscriptionOptions = [
  { action: 'notificationsAll', preference: 'ALL', label: 'All', description: 'All notifications' },
  { action: 'notificationsPersonalized', preference: 'PERSONALIZED', label: 'Personalized', description: 'Personalized notifications' },
  { action: 'notificationsNone', preference: 'NONE', label: 'None', description: 'No notifications' }
] as const;
