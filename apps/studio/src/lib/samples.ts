/** Default editor content per template — the same fixtures the engine tests use. */
import type { TemplateId } from './engine';

const invoice = {
  number: 'INV-2026-0042',
  issueDate: '2026-08-12',
  dueDate: '2026-09-11',
  currency: 'EUR',
  seller: {
    name: 'Atelier Lovelace SAS', street: '12 rue des Algorithmes', city: 'Paris',
    zip: '75011', country: 'FR', vatId: 'FR12345678901', email: 'billing@lovelace.example',
  },
  buyer: {
    name: 'Babbage Instruments Ltd', street: '5 Analytical Way', city: 'London',
    zip: 'EC1A 1BB', country: 'GB', vatId: 'GB987654321',
  },
  iban: 'FR7630006000011234567890189',
  buyerReference: 'PO-2026-118',
  notes: 'Merci pour votre confiance — thank you for your business.',
  paymentTerms: '30 days net',
  lines: [
    { description: 'Analytical engine calibration — on site', quantity: 2, unitPrice: 450, vatRate: 20 },
    { description: 'Difference gears (set of 12), hardened steel', quantity: 3, unitPrice: 89.99, vatRate: 20 },
    { description: 'Operator training, full day incl. materials', quantity: 1.5, unitPrice: 600, vatRate: 20 },
    { description: 'Documentation pack (PDF, perpetual updates)', quantity: 1, unitPrice: 120, vatRate: 5.5 },
  ],
};

const cv = {
  name: 'Ada Lovelace',
  title: 'Analytical Engine Programmer',
  contact: {
    email: 'ada@analytical.example', phone: '+44 20 7946 0001', location: 'London, UK',
    links: [{ label: 'github.com/alovelace' }],
  },
  summary: 'First computer programmer: wrote the first algorithm intended for machine execution, and saw further than anyone what engines could become.',
  experience: [
    {
      role: 'Senior Notes Author', org: 'Babbage & Co.', location: 'London', start: '1842', end: '1843',
      highlights: [
        'Translated Menabrea’s memoir on the Analytical Engine from the French',
        'Added Note G: the first published computer program (Bernoulli numbers)',
        'Anticipated non-numerical computing: music, graphics, symbolic science',
      ],
    },
    {
      role: 'Mathematical Correspondent', org: 'Independent scholarship', start: '1835', end: '1842',
      highlights: ['Studied symbolic logic with De Morgan', 'Corresponded on computational machinery'],
    },
  ],
  education: [{ degree: 'Private tuition in mathematics', institution: 'Mary Somerville circle', end: '1835' }],
  skills: [
    { category: 'Engines', items: ['Analytical Engine', 'Difference Engine'] },
    { category: 'Mathematics', items: ['Symbolic logic', 'Bernoulli numbers', 'Calculus of operations'] },
  ],
  languages: [{ name: 'English', level: 'native' }, { name: 'French', level: 'fluent' }],
};

const report = {
  title: 'Quarterly Engine Telemetry',
  subtitle: 'Analytical Engine Division — Q3 2026',
  author: 'A. Lovelace',
  affiliation: 'Babbage Instruments Ltd',
  date: '2026-09-30',
  abstract: 'Gear-wear telemetry remained nominal across the fleet; one gear train exceeded tolerance and was replaced without data loss.',
  sections: [
    {
      heading: 'Scope and method',
      blocks: [
        { type: 'paragraph', text: 'This report summarises telemetry from forty-two gear trains over the third quarter. Wear is modelled as a function of revolutions, lubrication interval, and ambient dust.' },
        { type: 'list', ordered: true, items: ['Collection and validation of revolution counters', 'Wear-model comparison against Q2 baselines', 'Outlier inspection and root-cause notes'] },
      ],
    },
    {
      heading: 'Findings',
      blocks: [
        { type: 'paragraph', text: [{ text: 'Wear rates were nominal across the fleet' }, { text: ', with a single exception.', note: 'Train 17 was replaced on 2026-08-19; total downtime three hours.' }] },
        { type: 'table', columns: ['*', 'auto', 'auto'], header: 1, rows: [['Metric', 'Q2', 'Q3'], ['Mean wear (mm)', '0.11', '0.10'], ['Outliers', '0', '1'], ['Availability', '99.7%', '99.8%']] },
        { type: 'quote', text: 'The engine seldom lies; our models often do.', source: 'Field manual, 3rd edition' },
      ],
    },
    {
      heading: 'Recommendations', level: 2,
      blocks: [{ type: 'paragraph', text: 'Increase sampling cadence to weekly for trains older than five years, and stock one spare barrel per ten trains.' }],
    },
  ],
};

const letter = {
  sender: { name: 'Atelier Lovelace SAS', lines: ['12 rue des Algorithmes', '75011 Paris', 'France'], email: 'hello@lovelace.example' },
  recipient: { name: 'Babbage Instruments Ltd', lines: ['5 Analytical Way', 'London EC1A 1BB', 'United Kingdom'] },
  date: '2026-08-12', place: 'Paris',
  subject: 'Maintenance contract renewal — Analytical Engine No. 7',
  salutation: 'Dear Dr. Babbage,',
  body: [
    'Your maintenance contract for Analytical Engine No. 7 expires on 30 September 2026. We would be pleased to renew it under the same terms for a further twelve months, including the quarterly barrel inspection introduced this spring.',
    'Please return the enclosed countersigned copy at your earliest convenience. As always, our workshop remains at your disposal for any unscheduled intervention.',
  ],
  closing: 'Sincerely,',
  signatureName: 'Ada Lovelace, Director',
  postscript: ['Enclosures: 2', 'cc: C. Wheatstone'],
};

const paper = {
  title: 'On the Mechanical Computation of Bernoulli Numbers',
  authors: [
    { name: 'A. Lovelace', affiliation: 'Babbage Instruments Ltd', email: 'ada@analytical.example' },
    { name: 'C. Babbage', affiliation: 'Babbage Instruments Ltd' },
  ],
  abstract: 'We describe an algorithm for the Analytical Engine that computes Bernoulli numbers via chained operations, analyse its operation-card complexity, and show the engine suffices for any finite system of operations.',
  keywords: ['Analytical Engine', 'Bernoulli numbers', 'operation cards'],
  sections: [
    {
      heading: 'Introduction',
      paragraphs: [
        'The Analytical Engine weaves algebraical patterns, much as the Jacquard loom weaves flowers and leaves [1].',
        [{ text: 'We assume familiarity with the store and the mill' }, { text: ', and with the punched-card control thereof.', note: 'See [2] for a complete mechanical description of the mill barrel.' }],
      ],
    },
    { heading: 'Method', paragraphs: ['The computation proceeds in cycles of variable clearances, each governed by an operation card.'] },
    { heading: 'Card complexity', level: 2, paragraphs: ['The card count grows linearly with the index of the desired Bernoulli number.'] },
  ],
  references: [
    'L. F. Menabrea, “Sketch of the Analytical Engine,” Bibliothèque Universelle de Genève, 1842.',
    'C. Babbage, Passages from the Life of a Philosopher, Longman, 1864.',
  ],
};

const screenplay = `Title: The Difference
Author: A. Lovelace
Draft date: 2026-08-12
Contact: Atelier Lovelace, Paris

INT. BABBAGE'S WORKSHOP - DAY

Gear trains cover every bench. ADA LOVELACE, 27, studies a barrel of punched cards. CHARLES BABBAGE hunches over the mill.

ADA
(reading a card)
Your mill drops a carry on the ninth digit. Every ninth digit.

CHARLES
Prove it.

ADA
I already have. Twice.

The engine CLANKS. A gear tooth shears off and skitters across the floor.

CHARLES
(sheepish)
The engine agrees with you.

ADA
The engine always agrees
with me.

CHARLES ^
Then let us argue about music instead.

CUT TO:

INT. DRAWING ROOM - NIGHT

Candlelight. Ada sketches loops on paper.

ADA
(whispering)
One day it will compose.

> FADE OUT.
`;

export const SAMPLES: Record<TemplateId, string> = {
  invoice: JSON.stringify(invoice, null, 2),
  cv: JSON.stringify(cv, null, 2),
  report: JSON.stringify(report, null, 2),
  letter: JSON.stringify(letter, null, 2),
  paper: JSON.stringify(paper, null, 2),
  screenplay,
};
