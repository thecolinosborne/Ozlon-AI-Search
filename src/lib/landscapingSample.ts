import garden from '@/assets/landscaping-garden.jpg';
import styles from '@/styles/landscaping-sample.css?raw';

export const landscapingSample = {
  id: 'sample-landscaping',
  domain: 'Illustrative landscaping sample',
  business_name: 'Fieldwork Landscaping',
  html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><base href="about:srcdoc"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fieldwork Landscaping — Sample design</title><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400&family=Inter:wght@300;400;600&display=swap" rel="stylesheet"><style>${styles}</style></head><body>
  <header class="hero"><nav class="nav"><a class="brand" href="#home">Fieldwork.</a><a class="nav-link" href="#services">Our services ↗</a></nav>
  <div class="photo" id="home"><img src="${garden}" width="1536" height="1024" alt="A landscaped residential garden with native flowers and a stone pathway"></div>
  <div class="hero-copy"><p class="eyebrow">Fieldwork Landscaping</p><h1>Crafting <em>beautiful</em><br>living spaces.</h1><p class="intro">Thoughtful gardens. Beautiful stonework. Outdoor spaces that feel like home.</p><a class="cta" href="#work">Explore our work <span aria-hidden="true">↗</span></a><a class="scroll" href="#services">Discover <span></span>↓</a></div></header>
  <section class="section" id="services"><p class="eyebrow">Designed. Built. Cared for.</p><h2>Room to grow.</h2><div class="services"><article class="service"><h3>Garden design</h3><p>Planting plans that bring texture, color, and life to your outdoor space.</p></article><article class="service"><h3>Patios & pathways</h3><p>Thoughtfully placed stonework connects your home to the outdoors.</p></article><article class="service"><h3>Landscape care</h3><p>Seasonal attention that keeps your garden looking its best.</p></article></div></section>
  <section class="section" id="work"><p class="eyebrow">A garden, reimagined</p><h2>Nature meets intention.</h2><img class="project-photo" src="${garden}" loading="lazy" width="1536" height="1024" alt="Illustrative garden design with flowering borders and architectural stepping stones"><p class="caption">Illustrative project imagery · Sample website</p></section>
  <section class="section"><h2>Made for life outside.</h2><p>From the first planting plan to the final stone, every detail works together to create a welcoming place to gather, unwind, and grow.</p></section>
  <div class="contact" id="contact"><section class="section"><h2>What could your garden become?</h2><p>A beautiful outdoor space starts with a conversation.</p><a class="cta" href="#services">Explore the possibilities <span aria-hidden="true">↗</span></a></section></div><footer><span>Fieldwork Landscaping</span><span>Illustrative sample · Not a real client</span></footer></body></html>`,
};