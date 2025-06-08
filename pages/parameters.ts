export const SENTRY_CONFIG = {
  baseUrl: 'https://sprouts-x2.sentry.io',
  apiBaseUrl: 'https://us.sentry.io/api/0',
  organization: 'sprouts-x2',
};

export type Project = {
  projectId: string;
  name: string;
};

export const PROJECTS: Project[] = [
  {
    projectId: '4506947671425024',
    name: 'javascript-react',
  },
  {
    projectId: '4509228726681602',
    name: 'javascript-react-qa',
  },
];

//To choose the projects, change the index of SELECTED_PROJECT (0,1)
//By default, it is set to 0 i.e., Pointing to Production
export const SELECTED_PROJECT =  0; 

// To choose the sort field, uncomment the line for FIELD_SORTS
export const FIELD_SORTS = ['p95(transaction.duration)'];
// export const FIELD_SORTS = ['p75(transaction.duration)'];
// export const FIELD_SORTS = ['p50(transaction.duration)'];

// To choose the field selected, uncomment the line for FIELD_SELECTED
export const FIELD_SELECTED = 'p95';
// export const FIELD_SELECTED = 'p75';
// export const FIELD_SELECTED = 'p50';

// To choose the stats period, uncomment the line for STATS_PERIOD - by default it is set to 7d
// export const STATS_PERIOD = '1h';
// export const STATS_PERIOD = '24h';
// export const STATS_PERIOD = '14d';
export const STATS_PERIOD = '7d';
// export const STATS_PERIOD = '30d';
// export const STATS_PERIOD = '90d';

// To choose the transaction threshold, change the value of TRANSACTION_THRESHOLD
export const TRANSACTION_THRESHOLD = 10000;