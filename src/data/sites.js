// Site data for the Drained Seabed Explorer — northern Öresund.
//
// Authored in REAL WGS84 coordinates and projected into the world frame with
// geoToWorld (see geo.js). Verified source URLs come from docs/wrecks-oresundsdykning.json
// (oresundsdykning.se, vragguiden.dk, vrag.dk).

import { geoToWorld } from './geo.js';

export const REEFS = [
  {
    id: 'reef-disken',
    name: 'Disken',
    position: geoToWorld(56.0216, 12.6517),
    radius: 40,
    description:
      'A stony bank in the mid-sound, its washed boulders now crusted pale and standing above the drained floor around it.',
  },
  {
    id: 'reef-lappegrund',
    name: 'Lappegrund',
    position: geoToWorld(56.0589, 12.6183),
    radius: 40,
    description:
      'The broad shoal off the old Lappegrund lighthouse north of the narrows, a low rise of gravel and dead eelgrass.',
  },
  {
    id: 'reef-grollegrund',
    name: 'Grollegrund',
    position: geoToWorld(56.098, 12.617),
    radius: 40,
    description:
      'The Grollegrund boulder-reef reserve north of Helsingborg off Hittarp, a shallow 3–10 m tumble of stone now standing bare above the drained sound.',
  },
  {
    id: 'reef-lundakragrund',
    name: 'Lundåkragrund',
    position: geoToWorld(55.8648, 12.7783),
    radius: 48,
    description:
      'The shallowest bank in the southern sound toward Landskrona, a knuckle of moraine standing out of the flats.',
  },
];

export const WRECKS = [
  {
    id: 'wreck-ceylon-af-bergkvara',
    name: 'Ceylon af Bergkvara',
    position: geoToWorld(55.9381, 12.63485),
    heading: 0.11,
    length: 41,
    type: 'sailing ship',
    sunkYear: 1908,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/ceylon/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1955' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/bark-ceylon/' },
    ],
    description:
      'The sailing ship Ceylon collided with the Wilson steamer Novo near Ven on 19 December 1908 and sank immediately; her crew were transferred to safety. The wreck was later destroyed by the pilot service as a navigation hazard. She lay at 20 m before the sound drained.',
  },
  {
    id: 'wreck-cementbaten',
    name: 'Cementbåten',
    position: geoToWorld(55.86298, 12.73185),
    heading: 5.43,
    length: 35,
    type: 'concrete barge / caisson',
    sunkYear: 1956,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/cementbaten/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1862' },
    ],
    description:
      'A concrete caisson intended for the Trelleborg harbour expansion began leaking and sank while under tow by the tug Härdig on 24-25 April 1956. Wreck lies 24-27 m deep, standing about 4 m off the bottom.',
  },
  {
    id: 'wreck-anemonvraket',
    name: 'Anemonvraket',
    position: geoToWorld(55.8305, 12.69275),
    heading: 1.2,
    length: 25,
    type: 'concrete barge',
    sunkYear: null,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/anemonvraket/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1837' },
    ],
    description:
      'A concrete barge, 25 m long and 7 m wide, named for the sea anemones that now cover its structure.',
  },
  {
    id: 'wreck-johannes-l',
    name: 'Johannes L',
    position: geoToWorld(56.00541, 12.71536),
    heading: 2.1,
    length: 49,
    type: 'cargo ship',
    sunkYear: 1979,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/johannes-l/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2045' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/m-s-johannes-l/' },
    ],
    description:
      'On 26 November 1979 Johannes L left Helsingborg with a hull breach from an earlier collision with a dock piling; strong winds caused her to sink in shallow water near shore. She lay at 9 m before the sound drained.',
  },
  {
    id: 'wreck-livlig',
    name: 'Livlig',
    position: geoToWorld(55.89362, 12.65861),
    heading: 5.52,
    length: 28,
    type: 'vessel',
    sunkYear: 1898,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/livlig/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1899' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/brigantine-livlig/' },
    ],
    description:
      'Livlig collided with the ship Cleopatra on 29 August 1898 while sailing from England to Copenhagen; after temporary repairs she sank in rough morning winds with the loss of six of eighteen crew. She lay at 16 m before the sound drained.',
  },
  {
    id: 'wreck-kalle',
    name: 'Kalle',
    position: geoToWorld(55.97962, 12.6335),
    heading: 2.92,
    length: 20,
    type: 'fishing vessel',
    sunkYear: null,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/kalle/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2003' },
    ],
    description:
      'A fishing vessel roughly 20 by 5 m, now overgrown with anemones and mussels, lying with its bow pointing 230 degrees; the circumstances of its sinking are undocumented.',
  },
  {
    id: 'wreck-s-s-otto',
    name: 'S/S Otto',
    position: geoToWorld(56.07443, 12.62305),
    heading: 3.55,
    length: 50,
    type: 'steamer',
    sunkYear: 1892,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/s-s-otto/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2149' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/s-s-otto/' },
    ],
    description:
      'Otto sank on 7 August 1892 after colliding with the steamer Thorsa near Lappegrund lighthouse; the impact breached her engine room and she sank immediately. She lay at 31 m before the sound drained.',
  },
  {
    id: 'wreck-bella-maria',
    name: 'Bella Maria',
    position: geoToWorld(55.86688, 12.68347),
    heading: 1,
    length: 28,
    type: 'motorboat',
    sunkYear: 2020,
    source: 'Öresundsdykning / Vrag.dk',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/bella-maria/' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/motorbaad-bella-maria/' },
    ],
    description:
      'The motorboat Bella Maria lost its propeller on 17 May 2020 and, while being towed to Rungsted harbour, was flooded by heavy seas and sank rapidly. She lay at 14 m before the sound drained.',
  },
  {
    id: 'wreck-k7-bevakningsfartyg',
    name: 'K7 Bevakningsfartyg',
    position: geoToWorld(55.98642, 12.6368),
    heading: 0.31,
    length: 30,
    type: 'patrol / guard vessel',
    sunkYear: null,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/k7-bevakningsfartyg/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2013' },
    ],
    description:
      'An exploded steel vessel missing its bow, likely the K7 patrol boat; the circumstances of its sinking are not documented on the source page. She lay at 14 m before the sound drained.',
  },
  {
    id: 'wreck-landstigningsbaten',
    name: 'Landstigningsbåten',
    position: geoToWorld(55.83627, 12.75625),
    heading: 0.6,
    length: 28,
    type: 'landing craft',
    sunkYear: 1948,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/landstigningsbaten/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1846' },
    ],
    description:
      'A landing craft that sank in 1948; it had been towed from Gothenburg to Valdemarsvik. Few details of its loss survive. She lay at 32 m before the sound drained.',
  },
  {
    id: 'wreck-s-s-emil-r-retzlaff',
    name: 'S.S. Emil R. Retzlaff',
    position: geoToWorld(56.07003, 12.61855),
    heading: 5.68,
    length: 28,
    type: 'steamer',
    sunkYear: 1904,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/s-s-emil-r-retzlaff/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2139' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/s-s-emil-r-retzlaff/' },
    ],
    description:
      'The steamer Emil R. Retzlaff collided with the steamship Napoli on 24 May 1904 while carrying iron ore to Stettin; all 17 crew were rescued. She lay at 33 m before the sound drained.',
  },
  {
    id: 'wreck-s-s-robert',
    name: 'S/S Robert',
    position: geoToWorld(55.92142, 12.71951),
    heading: 4.33,
    length: 28,
    type: 'steamer',
    sunkYear: 1905,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/s-s-robert/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1940' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/s-s-robert/' },
    ],
    description:
      'The steamer Robert (originally SS Hawarden) sank on 30 September 1905 after colliding with the steamer Niord just north of Ven; carrying sulfur ore, she went down in under a minute with only one survivor of her 20 crew. She lay at 42 m before the sound drained.',
  },
  {
    id: 'wreck-cimbria',
    name: 'Cimbria',
    position: geoToWorld(56.02955, 12.6446),
    heading: 5.16,
    length: 28,
    type: 'paddle steamer',
    sunkYear: 1858,
    source: 'Vrag.dk / Vragguiden',
    links: [
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/hjuldamper-cimbria/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2072' },
    ],
    description:
      'A Scottish-built paddle steamer that collided with the steamer Skåne and sank on 14 October 1858 in the Öresund; the uninsured loss ruined her owner. She lay at 20 m before the sound drained.',
  },
  {
    id: 'wreck-leda',
    name: 'Leda',
    position: geoToWorld(55.90762, 12.62961),
    heading: 2.33,
    length: 19,
    type: 'motor galeas',
    sunkYear: 1937,
    source: 'Vrag.dk / Vragguiden',
    links: [
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/m-gl-leda/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1918' },
    ],
    description:
      'A Danish motor galeas rammed by the larger steamer C.F. Tietgen in thick fog near Ven while carrying a cargo of bricks to Copenhagen, sinking in 1937. She lay at 20 m before the sound drained.',
  },
  {
    id: 'wreck-s-s-birgit',
    name: 'S.S. Birgit',
    position: geoToWorld(56.07677, 12.60207),
    heading: 4.66,
    length: 30,
    type: 'steamship',
    sunkYear: 1918,
    source: 'Vrag.dk / Vragguiden',
    links: [
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/s-s-birgit/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2175' },
    ],
    description:
      'A Swedish steamship carrying wood pulp from Göteborg to Lübeck that sank in under fifteen minutes after colliding with S.S. Alice on 19 November 1918; all crew were rescued. She lay at 30 m before the sound drained.',
  },
  {
    id: 'wreck-s-s-union',
    name: 'S.S. Union',
    position: geoToWorld(56.07313, 12.6238),
    heading: 5.84,
    length: 45,
    type: 'steamship',
    sunkYear: 1883,
    approximate: true,
    source: 'Vrag.dk / Vragguiden',
    links: [
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/s-s-union/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2143' },
    ],
    description:
      'A Norwegian steamship carrying rye from Königsberg to Bergen that sank rapidly after colliding with the English steamer Commodore near Lappegrund lighthouse on 14 June 1883; all 17 crew were rescued. She lay at 29 m before the sound drained.',
  },
  {
    id: 'wreck-ane-kirstine',
    name: 'Ane Kirstine',
    position: geoToWorld(55.9977, 12.62233),
    heading: 4.23,
    length: 19,
    type: 'schooner',
    sunkYear: 1903,
    approximate: true,
    source: 'Vrag.dk / Vragguiden',
    links: [
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/sk-ane-kirstine/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2050' },
    ],
    description:
      'A Danish two-masted schooner that sank in the Öresund on 9 October 1903 after taking on water while carrying refractory bricks; the crew abandoned ship when pumping failed. She lay at 20 m before the sound drained.',
  },
  {
    id: 'wreck-s-s-polaris',
    name: 'S/S Polaris',
    position: geoToWorld(56.0965, 12.56582),
    heading: 3.61,
    length: 50,
    type: 'steamer',
    sunkYear: 1924,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/s-s-polaris/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/2248' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/s-s-polaris/' },
    ],
    description:
      'The steamer Polaris collided with S/S Allegro af Stavanger on 16 January 1924 while inbound from Stockholm, was holed on the starboard side, and sank after about two hours. Her wreck lies just past the map’s northern edge, at the limit of the drained window. She lay at 28 m before the sound drained.',
  },
  {
    id: 'wreck-sinne-nordfisk',
    name: 'Sinne Nordfisk',
    position: geoToWorld(55.8235, 12.7004),
    heading: 3.75,
    length: 28,
    type: 'vessel',
    sunkYear: 1978,
    source: 'Öresundsdykning / Vragguiden',
    links: [
      { label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/sinne-nordfisk/' },
      { label: 'Vragguiden.dk', url: 'https://www.vragguiden.dk/vrag/1824' },
      { label: 'Vrag.dk', url: 'https://www.vrag.dk/sinne-nordfisk/' },
    ],
    description:
      'The vessel Sinne Nordfisk collided with the German ship Oliver Twist on 28 February 1978 and now rests at 22 m depth in the Öresund. Her wreck lies just past the map’s southern edge, at the limit of the drained window.',
  },
  {
    id: 'wreck-activ',
    name: 'Activ',
    position: geoToWorld(55.935, 12.6746),
    heading: 4.48,
    length: 44,
    type: 'barque',
    sunkYear: 1902,
    approximate: true,
    source: 'Öresundsdykning',
    links: [{ label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/activ/' }],
    description:
      'The barque Activ dragged her anchors during an intense storm on Christmas night 1902 and ran aground north of Ålabodarna in the Öresund while en route to Malmö.',
  },
  {
    id: 'wreck-frednas',
    name: 'Frednäs',
    position: geoToWorld(55.992, 12.715),
    heading: 2.26,
    length: 28,
    type: 'barque',
    sunkYear: 1902,
    approximate: true,
    source: 'Öresundsdykning',
    links: [{ label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/frednas/' }],
    description:
      'The Norwegian barque Frednäs, sailing in ballast from Copenhagen to Porsgrunn, ran aground on a sandy bottom during the severe Christmas storm of 1902; the captain and crew were rescued with local help.',
  },
  {
    id: 'wreck-franz',
    name: 'Franz',
    position: geoToWorld(55.985, 12.66),
    heading: 2.1,
    length: 28,
    type: 'cargo steamer',
    sunkYear: 1916,
    approximate: true,
    source: 'Öresundsdykning',
    links: [{ label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/franz/' }],
    description:
      'The cargo steamer Franz ran aground on 1 January 1916 while sailing from Wismar to Gothenburg with a coal cargo; her 15-person crew was rescued. Wreck lies between about 15 and 21 m.',
  },
  {
    id: 'wreck-carolina-sophia',
    name: 'Carolina Sophia',
    position: geoToWorld(55.928, 12.752),
    heading: 1.47,
    length: 25,
    type: 'schooner',
    sunkYear: 1858,
    approximate: true,
    source: 'Öresundsdykning',
    links: [{ label: 'Öresundsdykning', url: 'https://www.oresundsdykning.se/carolina-sophia-kanske/' }],
    description:
      'The Swedish schooner Carolina Sophia (possibly also identified as Oline Cecilie), under Captain Höglund, wrecked near Rydebäck during a severe storm in July 1858 while carrying coconut oil and American rosin.',
  },
];

export const PLACES = [
  { id: 'place-helsingborg', name: 'Helsingborg', position: geoToWorld(56.046, 12.694), kind: 'city' },
  { id: 'place-helsingor', name: 'Helsingør', position: geoToWorld(56.036, 12.612), kind: 'city' },
  { id: 'place-landskrona', name: 'Landskrona', position: geoToWorld(55.8703, 12.8306), kind: 'city' },
  { id: 'place-raa', name: 'Råå', position: geoToWorld(55.998, 12.74), kind: 'town' },
  { id: 'place-snekkersten', name: 'Snekkersten', position: geoToWorld(56.0151, 12.5852), kind: 'town' },
  { id: 'place-borstahusen', name: 'Borstahusen', position: geoToWorld(55.885, 12.815), kind: 'town' },
  { id: 'place-espergaerde', name: 'Espergærde', position: geoToWorld(55.995, 12.556), kind: 'town' },
  { id: 'place-domsten', name: 'Domsten', position: geoToWorld(56.095, 12.68), kind: 'town' },
  { id: 'place-kyrkbacken', name: 'Kyrkbacken', position: geoToWorld(55.9075, 12.6795), kind: 'village' },
  { id: 'place-sankt-ibb', name: 'Sankt Ibb', position: geoToWorld(55.913, 12.687), kind: 'village' },
];
