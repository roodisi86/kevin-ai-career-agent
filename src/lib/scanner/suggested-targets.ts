/**
 * Suggested starting list of target companies (public company names,
 * grouped by sector), based on the research input of 19 Nov 2026. These are
 * suggestions only: the user loads, edits or removes them, and every job
 * board is verified and approved before anything is scanned. Inclusion does
 * not mean the company currently has a matching vacancy or uses a
 * supported job system.
 */
export const SUGGESTED_TARGETS: { sector: string; companies: string[] }[] = [
  {
    sector: "FMCG, dranken en consumentenmerken",
    companies: [
      "Unilever", "Heineken", "AB InBev", "Duvel Moortgat", "Nestlé", "Danone", "PepsiCo", "Coca-Cola",
      "Red Bull", "JDE Peet's", "Mars", "Mondelez", "FrieslandCampina", "Diageo", "Pernod Ricard", "Bacardi",
      "Carlsberg", "Ferrero", "Kraft Heinz", "L'Oréal",
    ],
  },
  {
    sector: "Automotive, distributie en industrie",
    companies: [
      "Bridgestone", "Michelin", "Continental", "Pirelli", "Bosch", "Volvo Group", "Stellantis", "Mercedes-Benz",
      "BMW Group", "Toyota", "DHL", "Maersk", "Brenntag",
    ],
  },
  {
    sector: "Consultancy en zakelijke dienstverlening",
    companies: ["McKinsey", "BCG", "Bain", "Accenture", "Deloitte", "PwC", "EY", "KPMG", "Capgemini", "Gartner", "Sopra Steria", "Randstad"],
  },
  {
    sector: "Technologie en internationale platformbedrijven",
    companies: ["Microsoft", "Google", "Amazon", "Salesforce", "Adobe", "SAP", "Oracle", "Cisco", "Booking.com", "Uber", "Spotify", "Airbnb"],
  },
  {
    sector: "Hospitality, leisure, media en entertainment",
    companies: ["Marriott", "Hilton", "Accor", "IHG", "Radisson", "TUI", "Disney", "Netflix", "Universal Music", "Live Nation", "CTS Eventim", "Sodexo"],
  },
  {
    sector: "Retail en consumentenplatforms (Nederland)",
    companies: ["Philips", "Ahold Delhaize", "Coolblue", "Picnic", "Bol"],
  },
];
