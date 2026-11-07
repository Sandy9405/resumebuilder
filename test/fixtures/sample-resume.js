// Realistic fixture for layout tests (fictional person).
const item = (o) => ({ heading: '', org: '', location: '', dates: '', detail: '', note: '', bullets: [], reserve: [], hidden: false, ...o });
let n = 0;
const id = (p) => `${p}${++n}`;

export function sampleResume(template = 'hbs', pages = 1, { extraBullets = 0, longOrg = false } = {}) {
  n = 0;
  const filler = Array.from({ length: extraBullets }, (_, i) => `Reviewed pull requests and wrote design notes for service ${i + 1}, keeping the team's on-call runbooks current`);
  return {
    settings: { template, pages, buildMode: 'talk' },
    header: { name: 'Priya Raman', tagline: '', email: 'priya.raman@example.com', phone: '+91 98200 11223', location: 'Bengaluru', links: ['linkedin.com/in/priyaraman'], details: ['B.Tech, Computer Science'] },
    profile: { jobFamilies: ['Software Engineering'], currentRole: 'Software Engineer', yearsExperience: '3', industry: 'Logistics', specialization: 'Backend', careerStage: 'early', targetRole: '' },
    sections: [
      { id: id('s'), kind: 'experience', title: 'Professional Experience', hidden: false, items: [
        item({ id: id('i'), org: longOrg ? 'Shiprocket Logistics and Fulfilment Technology Services Private Limited (Platform Engineering Group)' : 'Shiprocket', location: 'Bengaluru', heading: 'Software Engineer II', dates: 'Jul 2022 – Present', bullets: [
          'Built a rate-shopping service in Go that compares 14 courier APIs per order, serving 2.1M requests a day at p99 latency under 120 ms',
          'Redesigned the label-generation queue, cutting failed shipments from 3.2% to 0.6% during the 2023 festive peak',
          'Led migration of order events from cron jobs to Kafka with two other engineers, removing a 15-minute delay in tracking updates',
          ...filler,
        ] }),
        item({ id: id('i'), org: 'Zeta', location: 'Bengaluru', heading: 'Software Engineering Intern', dates: 'Jan 2022 – Jun 2022', bullets: [
          'Wrote a reconciliation script for card settlements that replaced a manual daily spreadsheet check',
          'Added contract tests to the payments API, catching two breaking changes before release',
        ] }),
      ] },
      { id: id('s'), kind: 'education', title: 'Education', hidden: false, items: [
        item({ id: id('i'), heading: 'B.Tech, Computer Science and Engineering', org: 'National Institute of Technology Karnataka', note: 'NITK', dates: '2018 – 2022', detail: '8.71 / 10' }),
        item({ id: id('i'), heading: 'Class XII (CBSE)', org: 'Delhi Public School, Bangalore South', note: 'CBSE', dates: '2018', detail: '94.2%' }),
      ] },
      { id: id('s'), kind: 'projects', title: 'Projects', hidden: false, items: [
        item({ id: id('i'), heading: 'Open-source contributor, Apache Kafka', dates: '2023', detail: 'Java', bullets: ['Fixed a consumer rebalance bug reported by three users; patch merged in release 3.6'] }),
      ] },
      { id: id('s'), kind: 'achievements', title: 'Achievements', hidden: false, items: [
        item({ id: id('i'), heading: 'Ranked 212 among 1.2 lakh candidates in GATE Computer Science', dates: '2022' }),
        item({ id: id('i'), heading: 'Winner, Smart India Hackathon (logistics track)', dates: '2020' }),
      ] },
      { id: id('s'), kind: 'skills', title: 'Technical Skills', hidden: false, items: [
        item({ id: id('i'), heading: 'Languages', detail: 'Go, Java, Python, SQL' }),
        item({ id: id('i'), heading: 'Systems', detail: 'Kafka, PostgreSQL, Redis, Docker, Kubernetes, AWS' }),
      ] },
    ],
  };
}
