export interface StateInfo {
  name: string;
  abbreviation: string;
  hasIncomeTax: boolean;
  topMarginalRate: number; // approximate; for planning reference only
}

export const US_STATES: StateInfo[] = [
  { name: 'Alabama',        abbreviation: 'AL', hasIncomeTax: true,  topMarginalRate: 0.050 },
  { name: 'Alaska',         abbreviation: 'AK', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Arizona',        abbreviation: 'AZ', hasIncomeTax: true,  topMarginalRate: 0.025 },
  { name: 'Arkansas',       abbreviation: 'AR', hasIncomeTax: true,  topMarginalRate: 0.055 },
  { name: 'California',     abbreviation: 'CA', hasIncomeTax: true,  topMarginalRate: 0.133 },
  { name: 'Colorado',       abbreviation: 'CO', hasIncomeTax: true,  topMarginalRate: 0.044 },
  { name: 'Connecticut',    abbreviation: 'CT', hasIncomeTax: true,  topMarginalRate: 0.069 },
  { name: 'Delaware',       abbreviation: 'DE', hasIncomeTax: true,  topMarginalRate: 0.066 },
  { name: 'Florida',        abbreviation: 'FL', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Georgia',        abbreviation: 'GA', hasIncomeTax: true,  topMarginalRate: 0.055 },
  { name: 'Hawaii',         abbreviation: 'HI', hasIncomeTax: true,  topMarginalRate: 0.110 },
  { name: 'Idaho',          abbreviation: 'ID', hasIncomeTax: true,  topMarginalRate: 0.058 },
  { name: 'Illinois',       abbreviation: 'IL', hasIncomeTax: true,  topMarginalRate: 0.049 },
  { name: 'Indiana',        abbreviation: 'IN', hasIncomeTax: true,  topMarginalRate: 0.031 },
  { name: 'Iowa',           abbreviation: 'IA', hasIncomeTax: true,  topMarginalRate: 0.057 },
  { name: 'Kansas',         abbreviation: 'KS', hasIncomeTax: true,  topMarginalRate: 0.057 },
  { name: 'Kentucky',       abbreviation: 'KY', hasIncomeTax: true,  topMarginalRate: 0.045 },
  { name: 'Louisiana',      abbreviation: 'LA', hasIncomeTax: true,  topMarginalRate: 0.030 },
  { name: 'Maine',          abbreviation: 'ME', hasIncomeTax: true,  topMarginalRate: 0.075 },
  { name: 'Maryland',       abbreviation: 'MD', hasIncomeTax: true,  topMarginalRate: 0.058 },
  { name: 'Massachusetts',  abbreviation: 'MA', hasIncomeTax: true,  topMarginalRate: 0.090 },
  { name: 'Michigan',       abbreviation: 'MI', hasIncomeTax: true,  topMarginalRate: 0.043 },
  { name: 'Minnesota',      abbreviation: 'MN', hasIncomeTax: true,  topMarginalRate: 0.099 },
  { name: 'Mississippi',    abbreviation: 'MS', hasIncomeTax: true,  topMarginalRate: 0.047 },
  { name: 'Missouri',       abbreviation: 'MO', hasIncomeTax: true,  topMarginalRate: 0.048 },
  { name: 'Montana',        abbreviation: 'MT', hasIncomeTax: true,  topMarginalRate: 0.059 },
  { name: 'Nebraska',       abbreviation: 'NE', hasIncomeTax: true,  topMarginalRate: 0.066 },
  { name: 'Nevada',         abbreviation: 'NV', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'New Hampshire',  abbreviation: 'NH', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'New Jersey',     abbreviation: 'NJ', hasIncomeTax: true,  topMarginalRate: 0.108 },
  { name: 'New Mexico',     abbreviation: 'NM', hasIncomeTax: true,  topMarginalRate: 0.059 },
  { name: 'New York',       abbreviation: 'NY', hasIncomeTax: true,  topMarginalRate: 0.109 },
  { name: 'North Carolina', abbreviation: 'NC', hasIncomeTax: true,  topMarginalRate: 0.045 },
  { name: 'North Dakota',   abbreviation: 'ND', hasIncomeTax: true,  topMarginalRate: 0.025 },
  { name: 'Ohio',           abbreviation: 'OH', hasIncomeTax: true,  topMarginalRate: 0.035 },
  { name: 'Oklahoma',       abbreviation: 'OK', hasIncomeTax: true,  topMarginalRate: 0.048 },
  { name: 'Oregon',         abbreviation: 'OR', hasIncomeTax: true,  topMarginalRate: 0.099 },
  { name: 'Pennsylvania',   abbreviation: 'PA', hasIncomeTax: true,  topMarginalRate: 0.031 },
  { name: 'Rhode Island',   abbreviation: 'RI', hasIncomeTax: true,  topMarginalRate: 0.060 },
  { name: 'South Carolina', abbreviation: 'SC', hasIncomeTax: true,  topMarginalRate: 0.065 },
  { name: 'South Dakota',   abbreviation: 'SD', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Tennessee',      abbreviation: 'TN', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Texas',          abbreviation: 'TX', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'Utah',           abbreviation: 'UT', hasIncomeTax: true,  topMarginalRate: 0.047 },
  { name: 'Vermont',        abbreviation: 'VT', hasIncomeTax: true,  topMarginalRate: 0.088 },
  { name: 'Virginia',       abbreviation: 'VA', hasIncomeTax: true,  topMarginalRate: 0.058 },
  { name: 'Washington',     abbreviation: 'WA', hasIncomeTax: false, topMarginalRate: 0 },
  { name: 'West Virginia',  abbreviation: 'WV', hasIncomeTax: true,  topMarginalRate: 0.055 },
  { name: 'Wisconsin',      abbreviation: 'WI', hasIncomeTax: true,  topMarginalRate: 0.077 },
  { name: 'Wyoming',        abbreviation: 'WY', hasIncomeTax: false, topMarginalRate: 0 },
];

export function getStateInfo(abbreviationOrName: string): StateInfo | undefined {
  return US_STATES.find(
    (s) =>
      s.abbreviation === abbreviationOrName ||
      s.name.toLowerCase() === abbreviationOrName.toLowerCase()
  );
}
