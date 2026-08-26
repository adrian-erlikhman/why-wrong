/**
 * packs/biology.js -- Evolution and inheritance.
 *
 * The misconceptions here are among the best-documented in science education:
 * Lamarckian reasoning about individual organisms, teleology ("the species
 * needed to change"), and the conflation of dominance with frequency all
 * survive years of instruction and reappear on university entrance exams.
 *
 * Included to demonstrate that nothing in the pipeline is arithmetic-specific.
 * The inference, clustering and item analysis never inspect the subject.
 */

export default {
  id: 'biology-evolution',
  name: 'Evolution & Inheritance',
  subject: 'Biology',
  level: 'Grade 9-11',
  blurb: 'Natural selection, fitness, variation and Mendelian inheritance -- the corner of biology where intuitive but wrong causal stories are most durable.',
  source: 'built-in',

  misconceptions: [
    {
      id: 'B01',
      name: 'Individuals evolve during their lifetime',
      short: 'Organisms adapt, populations do not',
      belief: 'Treats evolution as something that happens to an organism while it lives, rather than to allele frequencies in a population across generations.',
      reteach: 'The unit of selection is the population, and the timescale is generations. Take a single beetle and ask what changed about *it* over its life: nothing. Then show the same population across five generations with the proportion of dark beetles rising. Students need to see that no individual changed colour for the idea to land -- the population changed composition because different individuals left different numbers of offspring.',
      verify: [
        'A moth population becomes darker over 50 years. Did any individual moth get darker? Explain.',
        'What exactly is different between generation 1 and generation 50?',
        'Can a single organism evolve? Why or why not?'
      ]
    },
    {
      id: 'B02',
      name: 'Evolution is goal-directed',
      short: 'Species change because they need to',
      belief: 'Explains adaptation by need or purpose -- the species developed the trait in order to survive -- rather than by differential survival of variation that already existed.',
      reteach: 'Teleology is the hardest one to shift because the language of the textbook encourages it. Ban the words "in order to" and "needed to" for a lesson and require every explanation to name (1) the variation that already existed, (2) which variants left more offspring, and (3) why. The constraint does the teaching; students discover the causal story is available without purpose.',
      verify: [
        'Rewrite "giraffes grew long necks to reach high leaves" without the word "to".',
        'Where did the variation in neck length come from in the first place?',
        'If a population has no variation in a trait, can selection act on it?'
      ]
    },
    {
      id: 'B03',
      name: 'Mutations are always harmful',
      short: 'All mutation is damage',
      belief: 'Treats mutation as uniformly deleterious, which makes the origin of beneficial variation inexplicable and quietly forces a teleological account of adaptation.',
      reteach: 'This misconception props up B02, so treat them together. Most mutations are neutral, a minority are harmful, a small minority are beneficial -- and "beneficial" is relative to an environment, not absolute. The sickle-cell allele is the standard case precisely because it is harmful and protective in the same body depending on the malaria context.',
      verify: [
        'Classify: a mutation in non-coding DNA. Harmful, neutral, or beneficial?',
        'Is the sickle-cell allele harmful? State the environment in your answer.',
        'If all mutations were harmful, where would new adaptations come from?'
      ]
    },
    {
      id: 'B04',
      name: 'Fitness means physical strength',
      short: 'Survival of the strongest',
      belief: 'Reads "fittest" as strongest, fastest or biggest rather than as reproductive success in a particular environment.',
      reteach: 'Fitness is a count of surviving offspring and nothing else. Give three organisms -- a large male that fathers none, a small one that fathers eight, a fast one eaten before breeding -- and have students rank fitness. The ranking inverts the intuitive one, which is the point. "Survival of the fittest" is a circular phrase students should learn to distrust.',
      verify: [
        'Rank by fitness: an organism with 0 offspring, 3 offspring, 9 offspring.',
        'Can a physically weaker organism have higher fitness? Give an example.',
        'Define fitness without using the words strong or fast.'
      ]
    },
    {
      id: 'B05',
      name: 'Humans descended from modern chimpanzees',
      short: 'We came from chimps',
      belief: 'Reads a phylogeny as a ladder from living species to living species rather than as branching from shared ancestors.',
      reteach: 'A tree diagram read left-to-right invites this error. Draw the branch point explicitly and label the common ancestor as a third, extinct species. Ask which living species is "more evolved" -- the answer, that the question is malformed because both lineages have been evolving for exactly the same time, is the concept.',
      verify: [
        'On a tree, where are humans and chimpanzees relative to their common ancestor?',
        'How long has the chimpanzee lineage been evolving compared with the human lineage?',
        'Is any living species ancestral to another living species?'
      ]
    },
    {
      id: 'B06',
      name: 'Dominant alleles are more common',
      short: 'Dominant means frequent',
      belief: 'Confuses dominance, which is about how an allele is expressed in a heterozygote, with frequency, which is about how common it is in a population.',
      reteach: 'Two independent ideas share one word. Polydactyly is dominant and rare; blue eyes are recessive and common in some populations. Give the frequencies first and ask students to predict dominance, then reveal it -- the failure of prediction is the lesson. Insist on the definition: dominant describes what happens in a heterozygote, nothing more.',
      verify: [
        'Polydactyly is dominant and affects about 1 in 1000. Explain how both can be true.',
        'Define dominance without referring to how common an allele is.',
        'A recessive allele has frequency 0.9. What proportion show the recessive phenotype?'
      ]
    },
    {
      id: 'B07',
      name: 'Heterozygotes show a blended phenotype',
      short: 'Aa gives an in-between trait',
      belief: 'Applies blending inheritance to a Mendelian trait, so a heterozygote is expected to show an intermediate form rather than the dominant one.',
      reteach: 'Blending was the pre-Mendelian model and it is intuitive, so it returns whenever attention lapses. Run a monohybrid cross on the board and have students predict the heterozygote phenotype before the reveal. Then distinguish the genuine exceptions -- incomplete dominance in snapdragons, codominance in AB blood -- so students learn these are named special cases, not the default.',
      verify: [
        'A cross of RR x rr gives Rr. What phenotype do the offspring show?',
        'How does incomplete dominance differ from complete dominance?',
        'In AB blood type, is the phenotype a blend? What is it instead?'
      ]
    },
    {
      id: 'B08',
      name: 'Selection creates new traits on demand',
      short: 'The environment produces the mutation',
      belief: 'Believes the environment induces the useful variation, so exposure to antibiotics causes the resistance mutation rather than selecting among bacteria that already varied.',
      reteach: 'Selection sorts; it does not author. The classic demonstration is that resistant bacteria can be isolated from a culture that has never met the antibiotic. Sequence the story explicitly on the board: variation exists first, the selective pressure arrives second, frequencies shift third. Students who can put those three in order stop inventing on-demand mutation.',
      verify: [
        'Did antibiotic resistance appear before or after the bacteria met the antibiotic?',
        'Put in order: pressure applied, variation exists, frequency shifts.',
        'Does spraying pesticide cause the resistance mutation? Explain.'
      ]
    }
  ],

  items: [
    { id: 'B-Q01', topic: 'Natural selection', stem: 'A population of beetles becomes darker over 30 generations. What best describes what happened?',
      opts: [
        { t: 'Dark beetles left more offspring each generation', c: true },
        { t: 'Individual beetles gradually darkened over their lives', mis: 'B01' },
        { t: 'The beetles darkened because they needed camouflage', mis: 'B02' },
        { t: 'The environment caused a darkening mutation', mis: 'B08' }
      ] },
    { id: 'B-Q02', topic: 'Natural selection', stem: 'Over 50 years a moth population shifts from pale to dark. Did any individual moth change colour?',
      opts: [
        { t: 'No — the proportion of dark moths changed', c: true },
        { t: 'Yes — each moth darkened to match the trees', mis: 'B01' },
        { t: 'Yes — moths adapted their colour within their lifetime', mis: 'B01' },
        { t: 'No — the trees changed instead', mis: null }
      ] },
    { id: 'B-Q03', topic: 'Natural selection', stem: 'Which statement describes evolution most accurately?',
      opts: [
        { t: 'Allele frequencies in a population change across generations', c: true },
        { t: 'Organisms adapt themselves to their surroundings over time', mis: 'B01' },
        { t: 'Species develop the features they require to survive', mis: 'B02' },
        { t: 'The strongest members of a species take over', mis: 'B04' }
      ] },
    { id: 'B-Q04', topic: 'Natural selection', stem: 'Why do giraffes have long necks?',
      opts: [
        { t: 'Longer-necked ancestors happened to leave more offspring', c: true },
        { t: 'They needed to reach high leaves, so their necks grew', mis: 'B02' },
        { t: 'Each giraffe stretched its neck and passed that on', mis: 'B01' },
        { t: 'Reaching high leaves triggered a neck-lengthening mutation', mis: 'B08' }
      ] },
    { id: 'B-Q05', topic: 'Natural selection', stem: 'A cave fish species loses its eyes over many generations. The best explanation is that:',
      opts: [
        { t: 'Eyes stopped being maintained by selection and drifted away', c: true },
        { t: 'The fish no longer needed eyes, so they disappeared', mis: 'B02' },
        { t: 'Darkness caused a mutation that removed the eyes', mis: 'B08' },
        { t: 'Each fish stopped using its eyes and they shrank', mis: 'B01' }
      ] },
    { id: 'B-Q06', topic: 'Mutation', stem: 'Which is true of mutations in a population?',
      opts: [
        { t: 'Most are neutral; a few are harmful and a few beneficial', c: true },
        { t: 'Essentially all of them damage the organism', mis: 'B03' },
        { t: 'They occur only when the environment demands them', mis: 'B08' },
        { t: 'They occur only during reproduction', mis: null }
      ] },
    { id: 'B-Q07', topic: 'Mutation', stem: 'Is the sickle-cell allele harmful?',
      opts: [
        { t: 'It depends on the environment — it protects against malaria', c: true },
        { t: 'Yes, all mutations are harmful by definition', mis: 'B03' },
        { t: 'No, mutations are how species get what they need', mis: 'B02' },
        { t: 'Yes, because it is recessive', mis: 'B06' }
      ] },
    { id: 'B-Q08', topic: 'Mutation', stem: 'A mutation occurs in a non-coding stretch of DNA. Most likely it is:',
      opts: [
        { t: 'Neutral — no effect on the organism', c: true },
        { t: 'Harmful — mutations damage the organism', mis: 'B03' },
        { t: 'Beneficial — the cell mutated where it was useful', mis: 'B08' },
        { t: 'Fatal', mis: 'B03' }
      ] },
    { id: 'B-Q09', topic: 'Fitness', stem: 'Which organism has the highest evolutionary fitness?',
      opts: [
        { t: 'A small one that raises 9 offspring to adulthood', c: true },
        { t: 'The largest and strongest, which raises 2', mis: 'B04' },
        { t: 'The fastest runner in the population, which raises 1', mis: 'B04' },
        { t: 'The one that lives longest but does not breed', mis: 'B04' }
      ] },
    { id: 'B-Q10', topic: 'Fitness', stem: 'In evolutionary biology, "fitness" means:',
      opts: [
        { t: 'Reproductive success in a given environment', c: true },
        { t: 'Physical strength and endurance', mis: 'B04' },
        { t: 'How well-adapted an organism feels', mis: 'B02' },
        { t: 'Lifespan', mis: null }
      ] },
    { id: 'B-Q11', topic: 'Fitness', stem: 'A physically weak organism produces far more surviving offspring than a strong one. Which has greater fitness?',
      opts: [
        { t: 'The weak one', c: true },
        { t: 'The strong one — fitness means strength', mis: 'B04' },
        { t: 'They are equal', mis: null },
        { t: 'Neither, fitness applies only to species', mis: 'B01' }
      ] },
    { id: 'B-Q12', topic: 'Common ancestry', stem: 'What is the relationship between humans and modern chimpanzees?',
      opts: [
        { t: 'Both descend from a shared extinct ancestor', c: true },
        { t: 'Humans evolved from modern chimpanzees', mis: 'B05' },
        { t: 'Chimpanzees are an earlier stage of human evolution', mis: 'B05' },
        { t: 'They are unrelated lineages', mis: null }
      ] },
    { id: 'B-Q13', topic: 'Common ancestry', stem: 'Which living species has been evolving for the longest time?',
      opts: [
        { t: 'All living species have been evolving for the same time', c: true },
        { t: 'Humans, because we are the most advanced', mis: 'B05' },
        { t: 'Bacteria, because they are the most primitive', mis: 'B05' },
        { t: 'Whichever has the most complex body plan', mis: 'B05' }
      ] },
    { id: 'B-Q14', topic: 'Common ancestry', stem: 'On an evolutionary tree, a branch point represents:',
      opts: [
        { t: 'A common ancestor that both lineages descend from', c: true },
        { t: 'The moment one living species turned into another', mis: 'B05' },
        { t: 'A species deciding to change direction', mis: 'B02' },
        { t: 'A mass extinction', mis: null }
      ] },
    { id: 'B-Q15', topic: 'Inheritance', stem: 'Polydactyly (extra fingers) is caused by a dominant allele but affects about 1 in 1000 people. Why?',
      opts: [
        { t: 'Dominance describes expression, not how common an allele is', c: true },
        { t: 'This must be an error — dominant alleles are the common ones', mis: 'B06' },
        { t: 'The allele is becoming dominant over time', mis: 'B02' },
        { t: 'Most carriers show a partial version of it', mis: 'B07' }
      ] },
    { id: 'B-Q16', topic: 'Inheritance', stem: 'In a population, a recessive allele has a frequency of 0.9. Which is true?',
      opts: [
        { t: 'The recessive phenotype is the common one here', c: true },
        { t: 'Impossible — recessive alleles are always rarer', mis: 'B06' },
        { t: 'The dominant phenotype still appears in most people', mis: 'B06' },
        { t: 'Everyone shows a blend of both', mis: 'B07' }
      ] },
    { id: 'B-Q17', topic: 'Inheritance', stem: 'A dominant allele is one that:',
      opts: [
        { t: 'Determines the phenotype in a heterozygote', c: true },
        { t: 'Is more common in the population', mis: 'B06' },
        { t: 'Produces a stronger or healthier organism', mis: 'B04' },
        { t: 'Overrides mutations', mis: 'B03' }
      ] },
    { id: 'B-Q18', topic: 'Inheritance', stem: 'A true-breeding red flower (RR) is crossed with a true-breeding white one (rr). R is completely dominant. The offspring are:',
      opts: [
        { t: 'All red', c: true },
        { t: 'All pink', mis: 'B07' },
        { t: 'Half red and half white', mis: null },
        { t: 'All white', mis: null }
      ] },
    { id: 'B-Q19', topic: 'Inheritance', stem: 'A person has genotype Aa for a completely dominant trait. Their phenotype is:',
      opts: [
        { t: 'The dominant phenotype, fully expressed', c: true },
        { t: 'Halfway between the two phenotypes', mis: 'B07' },
        { t: 'A mixture showing patches of each', mis: 'B07' },
        { t: 'Impossible to determine', mis: null }
      ] },
    { id: 'B-Q20', topic: 'Inheritance', stem: 'Blood type AB results from IA and IB together. This is an example of:',
      opts: [
        { t: 'Codominance — both alleles are fully expressed', c: true },
        { t: 'Blending — the blood types average out', mis: 'B07' },
        { t: 'The more common allele winning', mis: 'B06' },
        { t: 'A harmful mutation', mis: 'B03' }
      ] },
    { id: 'B-Q21', topic: 'Selection vs creation', stem: 'A bacterial population becomes antibiotic-resistant. Resistance mutations first appeared:',
      opts: [
        { t: 'Before the antibiotic was applied', c: true },
        { t: 'After exposure, in response to the antibiotic', mis: 'B08' },
        { t: 'Because the bacteria needed to survive', mis: 'B02' },
        { t: 'In individual bacteria that toughened up', mis: 'B01' }
      ] },
    { id: 'B-Q22', topic: 'Selection vs creation', stem: 'Spraying a field with pesticide leads to resistant insects. The pesticide:',
      opts: [
        { t: 'Selected among variation that was already present', c: true },
        { t: 'Caused the insects to mutate into resistant forms', mis: 'B08' },
        { t: 'Made each insect gradually tougher', mis: 'B01' },
        { t: 'Made the insects want to resist it', mis: 'B02' }
      ] },
    { id: 'B-Q23', topic: 'Selection vs creation', stem: 'A population has no variation at all in a particular trait. Natural selection acting on that trait will:',
      opts: [
        { t: 'Do nothing — there is nothing to select between', c: true },
        { t: 'Generate the variation that is needed', mis: 'B08' },
        { t: 'Cause individuals to change that trait', mis: 'B01' },
        { t: 'Favour the strongest individuals anyway', mis: 'B04' }
      ] },

    /* One deliberately weak item, matching the algebra pack: trivially easy, so
       it separates nobody. The item analysis has to notice unaided. */
    { id: 'B-Q24', topic: 'Natural selection', stem: 'Living things that reproduce pass genetic information to their offspring.',
      opts: [
        { t: 'True', c: true },
        { t: 'False', mis: null },
        { t: 'Only in plants', mis: null },
        { t: 'Only in animals', mis: null }
      ], _weak: 'trivial' }
  ],

  archetypes: [
    {
      id: 'A',
      label: 'Lamarckian reasoning',
      blurb: 'Explains adaptation through individual organisms changing and needing, rather than populations and differential reproduction.',
      core: ['B01', 'B02', 'B08'],
      weight: 0.30
    },
    {
      id: 'B',
      label: 'Genetics vocabulary',
      blurb: 'Confuses dominance with frequency and expects heterozygotes to blend.',
      core: ['B06', 'B07'],
      weight: 0.26
    },
    {
      id: 'C',
      label: 'Fitness and ancestry',
      blurb: 'Reads fitness as strength and phylogenies as ladders, with mutation treated as uniformly harmful.',
      core: ['B03', 'B04', 'B05'],
      weight: 0.26
    },
    {
      id: 'D',
      label: 'Broadly secure',
      blurb: 'No stable misconception. Errors are slips, and scattered rather than patterned.',
      core: [],
      weight: 0.18
    }
  ]
};
