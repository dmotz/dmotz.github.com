import {emdash1, gilded1, oridomi1, trystero1} from '#lib/media'

const defaultExpandedSize = 260
const olderExpandedSize = 220

export const projects = {
  trystero: {
    id: 'trystero',
    name: 'Trystero',
    media: trystero1,
    alt: 'Trystero peer-to-peer network demo',
    aspect: 1,
    expandedSize: defaultExpandedSize,
    details:
      'Turns any static site into a live multiplayer app. Import the library, join a room by name, and browsers discover each other instantly. No accounts, no API keys, no infra.',
    links: [
      {label: 'trystero.dev', href: 'https://trystero.dev'},
      {label: 'source code', href: 'https://github.com/dmotz/trystero'}
    ]
  },
  emdash: {
    id: 'emdash',
    name: 'Emdash',
    media: emdash1,
    alt: 'Emdash interface',
    aspect: 1,
    expandedSize: defaultExpandedSize,
    details:
      'An on-device AI tool that organizes highlights from ebooks and articles to uncover conceptual relationships across authors',
    links: [
      {label: 'Emdash', href: 'https://emdash.oxism.com'},
      {label: 'source code', href: 'https://github.com/dmotz/emdash'}
    ]
  },
  oridomi: {
    id: 'oridomi',
    name: 'OriDomi',
    media: oridomi1,
    alt: 'oriDomi paper folding demo',
    aspect: 1,
    expandedSize: olderExpandedSize,
    details:
      'A library for folding, bending, and slicing web elements like paper',
    links: [
      {label: 'demo site', href: '/oriDomi', external: true},
      {label: 'source code', href: 'https://github.com/dmotz/oriDomi'}
    ]
  },
  gildedGauge: {
    id: 'gildedGauge',
    name: 'Gilded Gauge',
    media: gilded1,
    alt: 'Gilded Gauge wealth visualization demo',
    aspect: 1,
    expandedSize: olderExpandedSize,
    details:
      'An experiment visualizing relative wealth through historical timelines and cascades of emoji commodities',
    links: [
      {label: 'demo site', href: 'https://oxism.com/GildedGauge'},
      {label: 'source code', href: 'https://github.com/dmotz/GildedGauge'}
    ]
  }
}

export const sections = {
  work: {
    details:
      'He currently works as a technical lead at Google Creative Lab in New York City.'
  },
  olderProjects: {
    projectIds: ['oridomi', 'gildedGauge']
  }
}

export const bodyCopy = [
  {text: 'Dan Motzenbecker', styleRole: 'name', heading: true},
  ' is a ',
  {sectionId: 'work', text: 'creative and software engineer'},
  '.',
  ' He specializes in rapid prototyping and open-source experiments. These include ',
  {projectId: 'trystero'},
  ', ',
  {projectId: 'emdash'},
  ', and ',
  {sectionId: 'olderProjects', text: 'others'},
  '.',
  ' You could send him an ',
  {text: 'email', href: 'mailto:dan@oxism.com'},
  ', ',
  {text: 'follow', href: 'https://x.com/dcmotz'},
  ' him, or peruse his ',
  {text: 'code', href: 'https://github.com/dmotz'},
  '.'
]

export const notFoundCopy = [
  'Four-o-four: not found. ',
  {text: 'Go home', href: '/'},
  ' or ',
  {text: 'send an email', href: 'mailto:dan@oxism.com'},
  '.'
]
