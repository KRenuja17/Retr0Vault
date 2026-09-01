import type {
  CreateCollectionInput,
  CreateDesignTypeInput,
} from "@retr0vault/shared";

export const developmentDesignTypes = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Print-Tech Paper",
    slug: "print-tech-paper",
    description:
      "Warm editorial layouts that combine tactile paper character with precise production marks and contemporary web structure.",
    deployFor:
      "Editorial portfolios, cultural institutions, studios, and products that benefit from a crafted printed-object sensibility.",
    risk:
      "Layering every print effect at once can turn purposeful material detail into visual noise.",
    briefBlock:
      "Use a warm paper ground, disciplined editorial typography, thin rules, and a small set of print-production details. Keep the composition crisp enough that texture reads as material rather than decoration.",
    principles: [
      "Treat the page as a designed sheet with visible edges, rules, and registration logic.",
      "Pair expressive serif display type with restrained monospaced marginalia.",
      "Use halftone or ink texture selectively around image-led focal points.",
    ],
    avoid: [
      "Paper textures that reduce text contrast.",
      "Generic rounded SaaS cards.",
      "Decorative print marks without an underlying grid.",
    ],
    vocabulary: [
      "warm paper ground",
      "halftone CMYK dots",
      "registration marks",
      "editorial serif",
      "mono coordinate labels",
      "thin black rules",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Dither Mono",
    slug: "dither-mono",
    description:
      "Stark black-and-white imagery processed through bitmap, dither, grain, and linework, with display typography carrying most of the authority.",
    deployFor:
      "Portfolios, agencies, launches, and waitlists where restraint and technical texture should read as confidence.",
    risk:
      "Dither the entire hero image to one bit and let a cropped wordmark run beyond the viewport only when legibility remains deliberate.",
    briefBlock:
      "Build a near-monochrome composition with processed imagery, monumental serif display type, tiny monospaced labels, technical marginalia, and at most one warm accent.",
    principles: [
      "Process imagery rather than presenting untouched photography.",
      "Use typography at extremes: monumental display type and tiny technical labels.",
      "Add coordinates, IDs, ruler ticks, timestamps, or registration marks as structured marginalia.",
    ],
    avoid: [
      "Glossy three-dimensional SaaS blobs.",
      "Untextured stock photography.",
      "Evenly distributed colourful palettes.",
      "Rounded-everything friendliness.",
    ],
    vocabulary: [
      "bitmap dither",
      "stark black and white",
      "film grain",
      "serif display",
      "split-screen form and art",
      "giant cropped wordmark",
      "high contrast",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Vast Quiet Cinematic",
    slug: "vast-quiet-cinematic",
    description:
      "Expansive image-led compositions with slow pacing, small typography, and generous negative space that lets atmosphere dominate.",
    deployFor:
      "Architecture, travel, film, automotive, hospitality, and premium products with strong visual material.",
    risk:
      "A quiet layout becomes empty rather than cinematic when the primary image lacks scale, depth, or a clear focal point.",
    briefBlock:
      "Let one cinematic frame control the composition. Use wide negative space, restrained captions, low interface density, and a muted palette derived from the image.",
    principles: [
      "Give the hero image enough scale to establish atmosphere before interface detail.",
      "Use sparse captions and quiet navigation aligned to a strict grid.",
      "Create pacing through large spatial intervals rather than decorative separators.",
    ],
    avoid: [
      "Dense card grids above the fold.",
      "Competing accent colours.",
      "Oversized marketing copy covering the focal subject.",
    ],
    vocabulary: [
      "cinematic still",
      "vast negative space",
      "quiet captioning",
      "horizon-led composition",
      "muted tonal palette",
      "slow visual pacing",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Data-as-Texture",
    slug: "data-as-texture",
    description:
      "Dense information, identifiers, plots, and repeated text become the visual material while remaining anchored by a readable hierarchy.",
    deployFor:
      "Research tools, technology studios, archives, music platforms, and analytical products that want information itself to create character.",
    risk:
      "Unstructured density quickly becomes illegible noise and can obscure the one action or fact that matters.",
    briefBlock:
      "Use repeated data, indexes, coordinates, or tabular fragments as texture around a clear primary hierarchy. Preserve alignment, rhythm, and meaningful contrast.",
    principles: [
      "Repeat structured information to form fields, bands, or image-like surfaces.",
      "Keep a legible primary reading path above the ambient data layer.",
      "Use monospaced type and aligned columns to make density feel intentional.",
    ],
    avoid: [
      "Random numbers used as meaningless decoration.",
      "Low-contrast microtype that cannot be read when needed.",
      "Charts without labels, units, or hierarchy.",
    ],
    vocabulary: [
      "tabular texture",
      "dense index field",
      "monospaced telemetry",
      "coordinate grid",
      "repeated metadata",
      "data bands",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Classical Remix",
    slug: "classical-remix",
    description:
      "Classical art, ornament, and typographic references are recomposed with contemporary cropping, scale, and interface restraint.",
    deployFor:
      "Fashion, publishing, museums, luxury goods, and cultural projects that need historical authority without feeling archival or nostalgic.",
    risk:
      "Literal period styling can become costume design; the classical source needs a clear contemporary counterpoint.",
    briefBlock:
      "Combine one authoritative classical reference with aggressive modern cropping, a disciplined neutral palette, and contemporary typographic or grid tension.",
    principles: [
      "Use classical imagery as active composition rather than framed decoration.",
      "Create tension through modern scale, cropping, and sparse interface elements.",
      "Limit ornament so the historical reference retains authority.",
    ],
    avoid: [
      "Theme-park antiquity and imitation parchment.",
      "Mixing unrelated historical periods without intent.",
      "Decorative flourishes around every control.",
    ],
    vocabulary: [
      "museum crop",
      "classical statuary",
      "modern grotesk counterpoint",
      "archival engraving",
      "monumental serif",
      "restrained ornament",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000006",
    name: "Glitched Antiquity",
    slug: "glitched-antiquity",
    description:
      "Ancient or archival imagery is interrupted by digital errors, compression, scan lines, and hard contemporary overlays.",
    deployFor:
      "Music, experimental culture, fashion, exhibitions, and identity work built around friction between history and technology.",
    risk:
      "Generic glitch filters can flatten the concept into a familiar effect with no relationship to the source material.",
    briefBlock:
      "Start with one credible antiquarian source, then introduce a limited digital failure language—channel separation, scan displacement, or compression blocks—aligned to the layout grid.",
    principles: [
      "Make every digital interruption respond to a feature in the source image.",
      "Balance damaged imagery with precise contemporary typography.",
      "Use abrupt overlays and crops to connect historical and digital layers.",
    ],
    avoid: [
      "Applying the same glitch preset to every asset.",
      "Neon cyberpunk colour without historical grounding.",
      "Distortion that removes the recognizable source entirely.",
    ],
    vocabulary: [
      "scan displacement",
      "channel separation",
      "corrupted engraving",
      "compression blocks",
      "archival interference",
      "hard digital overlay",
    ],
  },
  {
    id: "10000000-0000-4000-8000-000000000007",
    name: "Illustrated Storybook",
    slug: "illustrated-storybook",
    description:
      "Narrative illustration, crafted worlds, and expressive type create an inviting sequence with the clarity of an editorial story.",
    deployFor:
      "Education, culture, hospitality, playful products, and campaigns where narrative warmth matters more than technical minimalism.",
    risk:
      "Too many whimsical motifs can weaken navigation and make the experience feel juvenile rather than authored.",
    briefBlock:
      "Build the page as a sequence of illustrated scenes with a controlled palette, clear editorial hierarchy, and recurring visual motifs that support navigation and narrative.",
    principles: [
      "Let illustration establish place, character, or progression rather than fill empty space.",
      "Repeat a small family of motifs across scenes for continuity.",
      "Use expressive display type with calm, highly readable supporting copy.",
    ],
    avoid: [
      "Unrelated clip-art styles in one composition.",
      "Whimsy that hides calls to action or navigation.",
      "Overly saturated palettes without a dominant ground colour.",
    ],
    vocabulary: [
      "narrative illustration",
      "storybook sequence",
      "crafted miniature world",
      "expressive serif",
      "recurring visual motif",
      "gentle editorial pacing",
    ],
  },
] satisfies readonly (Omit<CreateDesignTypeInput, "sortOrder"> & {
  readonly id: string;
})[];

export const referenceStylesCollection = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Reference Styles",
  slug: "reference-styles",
  description:
    "Pinned references that define reusable visual styles and design directions.",
  isPinned: true,
  sortOrder: 0,
} satisfies CreateCollectionInput & { readonly id: string };
