// Runtime EN/SW toggle — NFR-L-2
export type Lang = 'en' | 'sw';

const strings = {
  en: {
    // Auth
    login: 'Login', logout: 'Logout', phone: 'Phone', pin: 'PIN',
    email: 'Email', password: 'Password', enterPin: 'Enter your 4–6 digit PIN',
    // Nav
    home: 'Home', record: 'Record', profile: 'Profile', tasks: "Today's Tasks",
    // Status
    offline: 'OFFLINE', syncing: 'Syncing', synced: 'Synced', queued: 'queued',
    savedLocally: '✓ Saved — will sync', syncedToOwner: '✓ Synced to owner',
    // Tasks
    overdue: 'OVERDUE', due: 'DUE', routine: 'Routine',
    noTasks: 'No tasks yet. Your manager will assign them. Pull to refresh.',
    // Records
    morningRound: 'Morning Round', mortality: 'Mortality', feeding: 'Feeding',
    health: 'Health / Vaccination', weightSample: 'Weight Sampling',
    physicalCount: 'Physical Count', closingStock: 'Closing Stock',
    // Fields
    waterLevel: 'Water', feedRemaining: 'Feed left (kg)', eggs: 'Eggs',
    cracked: 'Cracked', abnormal: 'Abnormal?', yes: 'Yes', no: 'No',
    deaths: 'Deaths', cause: 'Cause', photo: 'Photo', gpsCapture: 'GPS captured',
    submit: 'Submit', saveNext: 'Save & Next', startRound: 'Start Round',
    endRound: 'End Round', finish: 'Finish',
    required: 'Required', optional: 'Optional',
    photoRequired: 'Photo required', cameraTap: 'Take Photo',
    // Errors
    feedExceeds: 'Only {qty} {unit} of {item} on hand',
    mortalityExceeds: 'Batch has {qty} animals; cannot record {n} deaths',
    photoMandatory: 'Photo mandatory above {threshold} deaths',
    withdrawalBlocked: 'BLOCKED — {product} withdrawal until {date} ({days} days left).',
    withdrawalCleared: 'Cleared for sale — withdrawal elapsed (last dose {days} days ago).',
    // Owner
    dashboard: 'Dashboard', farm: 'Farm', inventory: 'Inventory',
    finance: 'Finance', people: 'People', config: 'Config', reports: 'Reports',
    alerts: 'Alerts', setup: 'Setup',
    // Setup
    setupWizard: 'Setup Wizard', step: 'Step',
    // KPIs
    fcr: 'FCR', mortality_pct: 'Mortality %', production: 'Production',
    grossMargin: 'Gross Margin', breakEven: 'Break-even', costPerUnit: 'Cost/unit',
    totalRevenue: 'Revenue', totalCost: 'Total Cost',
    // Misc
    language: 'Language', highContrast: 'High-contrast / Sunlight mode',
    pendingSync: 'Pending sync', conflictResolve: 'Resolve Conflict',
    keepMine: 'Keep mine', keepServer: 'Keep server', noData: 'No data yet.',
  },
  sw: {
    login: 'Ingia', logout: 'Toka', phone: 'Simu', pin: 'Nambari ya Siri',
    email: 'Barua pepe', password: 'Nenosiri', enterPin: 'Weka PIN yako ya tarakimu 4–6',
    home: 'Nyumbani', record: 'Rekodi', profile: 'Wasifu', tasks: 'Kazi za Leo',
    offline: 'BILA MTANDAO', syncing: 'Inasawazisha', synced: 'Imesawazishwa', queued: 'inasubiri',
    savedLocally: '✓ Imehifadhiwa — itasawazishwa', syncedToOwner: '✓ Imesawazishwa kwa mmiliki',
    overdue: 'IMECHELEWA', due: 'INASTAHILI', routine: 'Kawaida',
    noTasks: 'Hakuna kazi bado. Meneja wako atazipa. Vuta kusasisha.',
    morningRound: 'Zunguko la Asubuhi', mortality: 'Vifo', feeding: 'Kulisha',
    health: 'Afya / Chanjo', weightSample: 'Sampuli ya Uzito',
    physicalCount: 'Hesabu Halisi', closingStock: 'Hisa ya Mwisho',
    waterLevel: 'Maji', feedRemaining: 'Chakula kilichobaki (kg)', eggs: 'Mayai',
    cracked: 'Yaliyopasuka', abnormal: 'Isiyo ya kawaida?', yes: 'Ndiyo', no: 'Hapana',
    deaths: 'Vifo', cause: 'Sababu', photo: 'Picha', gpsCapture: 'GPS imekaguliwa',
    submit: 'Wasilisha', saveNext: 'Hifadhi & Endelea', startRound: 'Anza Zunguko',
    endRound: 'Maliza Zunguko', finish: 'Maliza',
    required: 'Lazima', optional: 'Si lazima',
    photoRequired: 'Picha inahitajika', cameraTap: 'Piga Picha',
    feedExceeds: 'Kuna {qty} {unit} tu ya {item}',
    mortalityExceeds: 'Kundi lina wanyama {qty}; haiwezekani kurekodi vifo {n}',
    photoMandatory: 'Picha lazima zaidi ya vifo {threshold}',
    withdrawalBlocked: 'IMEZUIWA — {product} hadi {date} (siku {days} zimebaki).',
    withdrawalCleared: 'Imeidhinishwa kuuza — muda wa kujiepusha umepita (dozi ya mwisho siku {days} zilizopita).',
    dashboard: 'Dashibodi', farm: 'Shamba', inventory: 'Hesabu',
    finance: 'Fedha', people: 'Watu', config: 'Mipangilio', reports: 'Ripoti',
    alerts: 'Tahadhari', setup: 'Usanidi',
    setupWizard: 'Msaidizi wa Usanidi', step: 'Hatua',
    fcr: 'FCR', mortality_pct: 'Asilimia ya Vifo', production: 'Uzalishaji',
    grossMargin: 'Faida Ghafi', breakEven: 'Usawa', costPerUnit: 'Gharama/kipande',
    totalRevenue: 'Mapato', totalCost: 'Gharama Yote',
    language: 'Lugha', highContrast: 'Hali ya Jua / Mwanga Mkali',
    pendingSync: 'Inangoja kusawazishwa', conflictResolve: 'Suluhisha Mgongano',
    keepMine: 'Weka yangu', keepServer: 'Weka ya seva', noData: 'Hakuna data bado.',
  },
} as const;

export type StringKey = keyof typeof strings.en;
export type Strings = typeof strings.en;

export function getStrings(lang: Lang): Strings {
  return strings[lang] as Strings;
}

export function t(lang: Lang, key: StringKey, vars?: Record<string,string|number>): string {
  let s: string = strings[lang][key] as string ?? strings.en[key] as string ?? key;
  if (vars) Object.entries(vars).forEach(([k,v]) => { s = s.replace(`{${k}}`, String(v)); });
  return s;
}
