// Sample resumes for the layout previews in setup. Every person, school and
// company here is made up. The same content is laid out by the real engine in
// each format, so a preview shows exactly what that format produces.

import { emptyResume, applyOp } from './ops.js';
import { TEMPLATES, FORMATS_BY_STAGE } from '../shared/templates.js';

const it = (o) => ({ heading: '', org: '', location: '', dates: '', detail: '', note: '', bullets: [], reserve_bullets: [], user_wording: [], ...o });

// The "note" column means different things in the two table formats:
// IITB shows the university or board, IIMA shows distinctions.
const eduNote = (template, board, distinction) => (template === 'iitb' ? board : template === 'iima' ? distinction : '');

// Formats differ in how much fits on a page, so each gets enough sample content
// to show a full page: level 1 is in every preview, 2 and 3 are added for roomier formats.
const DENSITY = { recent: { hbs: 1, iima: 2, pro: 2, iitb: 3 }, experienced: { hbs: 2, pro: 3 } };
const upTo = (level, list) => list.filter(([min]) => min <= level).map(([, value]) => value);

function recent(template) {
  const d = DENSITY.recent[template] || 1;
  // The table formats have narrow columns: use the short names people write there.
  const table = template === 'iitb' || template === 'iima';
  const college = table ? 'Northfield Tech' : 'Northfield Institute of Technology';
  const school = table ? 'Greenwood School' : 'Greenwood Public School';
  return {
    header: {
      name: 'Aarav Mehta',
      tagline: '',
      email: 'aarav.mehta@example.com',
      phone: '+91 90000 12345',
      location: 'Pune, India',
      links: ['linkedin.com/in/aarav-mehta-sample', 'github.com/aarav-sample'],
      details: ['B.Tech, Computer Science and Engineering'],
    },
    sections: [
      {
        kind: 'education',
        title: 'Education',
        items: [
          it({ heading: 'B.Tech, Computer Science', org: college, dates: '2022 – 2026', detail: '8.7 / 10', note: eduNote(template, 'Northfield University', 'Rank 4 of 120') }),
          it({ heading: 'Class XII', org: school, dates: '2022', detail: '94.2%', note: eduNote(template, 'CBSE', 'Maths topper') }),
          it({ heading: 'Class X', org: school, dates: '2020', detail: '96.0%', note: eduNote(template, 'CBSE', 'Merit scholar') }),
        ],
      },
      {
        kind: 'experience',
        title: 'Internships',
        items: [
          it({
            heading: 'Software Engineering Intern',
            org: 'Brightlane Logistics',
            location: 'Pune',
            dates: 'May 2025 – Jul 2025',
            bullets: [
              'Built a delivery-delay alert in Python that checks 40,000 shipments a day and warns the operations team 2 hours earlier than before',
              'Wrote 60 unit tests for the route-pricing service, which caught 3 defects before the monsoon-season release',
              'Reduced the nightly report run from 50 minutes to 12 minutes by rewriting 4 slow SQL queries',
            ],
          }),
          it({
            heading: 'Data Analyst Intern',
            org: 'Kite Payments',
            location: 'Remote',
            dates: 'Dec 2024 – Jan 2025',
            bullets: [
              'Analysed 1.2 million failed card payments and traced 18% of them to one bank timeout setting',
              'Built a weekly dashboard for the risk team that replaced a manual spreadsheet update',
            ],
          }),
        ],
      },
      {
        kind: 'projects',
        title: 'Projects',
        items: [
          it({
            heading: 'Campus Bus Tracker',
            detail: 'React Native, Node.js, PostgreSQL',
            dates: '2025',
            bullets: [
              'Built a mobile app that shows live locations of 14 campus buses; 2,300 students used it in the first month',
              'Cut average waiting time at the main gate from 11 minutes to 6 minutes, measured in a two-week survey',
            ],
          }),
          it({
            heading: 'Lecture Notes Search',
            detail: 'Python, FastAPI',
            dates: '2024',
            bullets: upTo(d, [
              [1, 'Indexed 900 pages of lecture notes so that students find a topic in one search; used by 3 courses'],
              [2, 'Answered a typical search in under 200 ms on a single low-cost server'],
            ]),
          }),
          ...upTo(d, [
            [
              3,
              it({
                heading: 'Mess Feedback Bot',
                detail: 'Python, Telegram API',
                dates: '2023',
                bullets: [
                  'Built a chat bot that collects daily meal ratings from 600 hostel residents',
                  'Gave the mess committee a weekly summary, which led to 5 menu changes in one semester',
                ],
              }),
            ],
          ]),
        ],
      },
      {
        kind: 'leadership',
        title: 'Positions of Responsibility',
        items: [
          it({
            heading: 'Lead, Coding Club',
            org: 'Northfield Institute of Technology',
            dates: '2024 – 2025',
            bullets: [
              'Led a team of 12 to run a 36-hour hackathon with 480 participants from 22 colleges',
              'Started weekly problem-solving sessions; average attendance grew from 25 to 90 students',
            ],
          }),
          ...upTo(d, [
            [
              2,
              it({
                heading: 'Coordinator, Placement Cell',
                org: 'Northfield Institute of Technology',
                dates: '2025 – 2026',
                bullets: ['Scheduled interviews for 35 companies and 400 students over a 3-week placement season'],
              }),
            ],
          ]),
        ],
      },
      {
        kind: 'achievements',
        title: 'Achievements',
        items: [
          it({ heading: 'Winner, State Smart Mobility Hackathon among 150 teams', dates: '2025' }),
          it({ heading: 'Ranked in the top 2% of 1.1 lakh candidates in the national engineering entrance test', dates: '2022' }),
          ...upTo(d, [[3, it({ heading: 'Merit scholarship for 3 consecutive years, awarded to the top 5% of the class', dates: '2023 – 2025' })]]),
        ],
      },
      ...upTo(d, [
        [
          3,
          {
            kind: 'extracurricular',
            title: 'Extracurricular Activities',
            items: [
              it({ heading: 'Captain of the hostel football team; runners-up among 8 teams in the inter-hostel league', dates: '2024' }),
              it({ heading: 'Taught basic computer skills to 30 school students as a weekend volunteer', dates: '2023' }),
            ],
          },
        ],
      ]),
      {
        kind: 'skills',
        title: 'Technical Skills',
        items: [
          it({ heading: 'Languages', detail: 'Python, Java, JavaScript, SQL' }),
          it({ heading: 'Tools', detail: 'React, Node.js, PostgreSQL, Git, Docker' }),
        ],
      },
    ],
    confirm_replace: false,
  };
}

function experienced(template) {
  const d = DENSITY.experienced[template] || 1;
  return {
    header: {
      name: 'Meera Nair',
      tagline: 'Product Manager · Payments and consumer growth',
      email: 'meera.nair@example.com',
      phone: '+91 90000 67890',
      location: 'Bengaluru, India',
      links: ['linkedin.com/in/meera-nair-sample'],
      details: [],
    },
    sections: [
      {
        kind: 'summary',
        title: 'Profile',
        items: [
          it({
            bullets: [
              'Product manager with 7 years in payments and consumer apps. Grew a bill-payments product from launch to 1.8 million monthly users, and led a checkout redesign that raised payment success from 86% to 93%.',
            ],
          }),
        ],
      },
      {
        kind: 'experience',
        title: 'Professional Experience',
        items: [
          it({
            heading: 'Senior Product Manager',
            org: 'Kite Payments',
            location: 'Bengaluru',
            dates: 'Apr 2022 – Present',
            note: template === 'pro' ? 'Product Team of the Year, 2024' : '',
            bullets: [
              'Launched bill payments for 9 utility categories; the product reached **1.8 million monthly users** in 14 months',
              'Led a checkout redesign with 8 engineers and 2 designers that raised payment success **from 86% to 93%**',
              'Cut refund time from 7 days to 2 days by moving 3 partner banks to an instant-refund API',
              'Set quarterly goals for a 14-person team and reported results to the leadership group each month',
              ...upTo(d, [
                [2, 'Added UPI AutoPay for recurring bills; 22% of monthly payers moved to automatic payment in 6 months'],
                [3, 'Reduced support tickets per 1,000 payments from 14 to 6 by showing the bank status on the receipt page'],
              ]),
            ],
          }),
          it({
            heading: 'Product Manager',
            org: 'Lumen Foods',
            location: 'Mumbai',
            dates: 'Jun 2019 – Mar 2022',
            bullets: [
              'Built a subscription plan for weekly grocery orders; **31% of active customers** joined in the first year',
              'Reduced order cancellations from 9% to 4% by showing live stock on the product page',
              'Ran 40 customer interviews and 12 pricing tests to choose the delivery-fee model',
              ...upTo(d, [
                [2, 'Launched a referral programme that brought 18% of new customers at half the usual cost'],
                [3, 'Worked with 6 engineers to cut app start time from 4.1 seconds to 1.9 seconds'],
              ]),
            ],
          }),
          it({
            heading: 'Business Analyst',
            org: 'Brightlane Logistics',
            location: 'Pune',
            dates: 'Jul 2017 – May 2019',
            bullets: [
              'Built the weekly carrier scorecard used to move 20% of shipments to faster carriers',
              'Automated 5 finance reports in SQL, which saved the team 10 hours each week',
              ...upTo(d, [[3, 'Trained 15 operations managers to use the scorecard in their weekly reviews']]),
            ],
          }),
        ],
      },
      {
        kind: 'education',
        title: 'Education',
        items: [
          it({ heading: 'MBA, Marketing and Strategy', org: 'Lakeview School of Management', dates: '2015 – 2017', detail: '3.6 / 4.0', note: eduNote(template, 'Lakeview University', "Dean's list") }),
          it({ heading: 'B.E., Electronics', org: 'Northfield Institute of Technology', dates: '2011 – 2015', detail: '8.2 / 10', note: eduNote(template, 'Northfield University', 'Department rank 9 of 110') }),
        ],
      },
      ...upTo(d, [
        [
          3,
          {
            kind: 'leadership',
            title: 'Leadership',
            items: [
              it({
                heading: 'Mentor, Women in Product (city chapter)',
                dates: '2021 – Present',
                bullets: ['Mentored 9 early-career product managers; 6 moved into full product roles within a year'],
              }),
            ],
          },
        ],
        [
          2,
          {
            kind: 'certifications',
            title: 'Certifications',
            items: [
              it({ heading: 'Certified Scrum Product Owner', dates: '2020' }),
              it({ heading: 'Advanced SQL for Analysts (12-week course)', dates: '2018' }),
            ],
          },
        ],
      ]),
      {
        kind: 'skills',
        title: 'Skills',
        items: [
          it({ heading: 'Product', detail: 'Roadmaps, pricing tests, customer research, A/B testing' }),
          it({ heading: 'Tools', detail: 'SQL, Amplitude, Figma, Jira' }),
        ],
      },
    ],
    confirm_replace: false,
  };
}

const BUILD = { recent, experienced };
const cache = new Map();

/** Sample resumes for one career stage, one per format offered at that stage. */
export function samplesFor(stage) {
  const key = BUILD[stage] ? stage : 'recent';
  if (!cache.has(key)) {
    const out = {};
    for (const template of FORMATS_BY_STAGE[key]) {
      if (!TEMPLATES[template]) continue;
      const resume = emptyResume({ template, pages: 1, stage: key, buildMode: 'talk' });
      applyOp(resume, 'create_resume', BUILD[key](template));
      out[template] = resume;
    }
    cache.set(key, out);
  }
  return cache.get(key);
}
