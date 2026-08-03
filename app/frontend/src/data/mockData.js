// Mock signers — seeded into localStorage on first run (browser dev mode only;
// in Electron the list is synced from data/global/report_signer.json).

export const MOCK_SIGNERS = [
  { id: 'sig_001', first: 'David',  last: 'Cohen',    license: 'AME-IL-4412' },
  { id: 'sig_002', first: 'Yael',   last: 'Shapiro',  license: 'AME-IL-3891' },
  { id: 'sig_003', first: 'Natan',  last: 'Levine',   license: 'AME-IL-5210' },
]
