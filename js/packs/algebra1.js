/**
 * packs/algebra1.js -- Algebra 1: exponents, signs, fractions, linear equations.
 *
 * A subject pack is a self-contained diagnostic instrument: a taxonomy of named
 * misconceptions, an item bank whose every wrong option is mapped to one of
 * them, and a set of archetypes describing which misconceptions tend to travel
 * together in a real classroom.
 *
 * Nothing downstream knows this pack is about algebra. Swap it for biology or
 * for something a language model wrote thirty seconds ago and the inference,
 * clustering and item analysis behave identically.
 */

export default {
  id: 'algebra-1',
  name: 'Algebra 1',
  subject: 'Mathematics',
  level: 'Grade 8-9',
  blurb: 'Exponent rules, signed arithmetic, fraction operations and one-step equations -- the cluster of topics where procedural fluency most often hides a broken rule.',
  source: 'built-in',

  misconceptions: [
  {
    id: 'M01',
    name: 'Negative exponent means negative result',
    short: 'Negative exponent to negative number',
    belief: 'Reads the minus sign in an exponent as a sign on the value, so 2^-3 becomes -8 instead of 1/8.',
    reteach: 'The minus sign in an exponent is an instruction, not a sign. Anchor it in the pattern 2^3=8, 2^2=4, 2^1=2, 2^0=1 -- each step down divides by 2, so 2^-1 must be 1/2. Have students continue the halving pattern themselves before you write the reciprocal rule at all. The rule is the conclusion of the pattern, not a substitute for it.',
    verify: ['Evaluate 3^-2.', 'Continue the pattern: 4^2, 4^1, 4^0, 4^-1.', 'True or false: 10^-1 is a negative number. Explain.']
  },
  {
    id: 'M02',
    name: 'Exponent multiplies the base',
    short: 'Treats a^b as a times b',
    belief: 'Collapses exponentiation into multiplication, so 3^4 becomes 12 and (x+3)^2 becomes 2x+6.',
    reteach: 'This survives because it gives the right answer exactly once, at a^2 when a=2. Kill it with a counting task rather than a rule: ask for the number of outcomes from 3 coins, then 4, and let the doubling do the work. Repeated multiplication has to be re-grounded before the notation comes back.',
    verify: ['Evaluate 3^4.', 'How many 3-letter codes use only A and B?', 'Is 2^5 equal to 10? Show why or why not.']
  },
  {
    id: 'M03',
    name: 'Multiplies exponents when multiplying like bases',
    short: 'x^a . x^b to x^(ab)',
    belief: 'Applies the power-of-a-power rule to a product, so x^2 . x^3 becomes x^6 rather than x^5.',
    reteach: 'Students hold two rules and no way to tell them apart, so they choose by coin flip. Do not restate the rules -- make them expand. Writing x^2 . x^3 as (x.x)(x.x.x) and counting five factors is self-correcting, and it also shows why the other rule multiplies. Return to expansion every time the two rules collide.',
    verify: ['Simplify a^5 . a^2 by expanding first.', 'Simplify (a^5)^2 by expanding first.', 'Explain in one sentence why those two answers differ.']
  },
  {
    id: 'M04',
    name: 'Adds exponents when raising a power to a power',
    short: '(x^a)^b to x^(a+b)',
    belief: 'The mirror image of M03: applies the product rule to a nested power, so (x^3)^2 becomes x^5 instead of x^6.',
    reteach: 'Same root cause as M03 and best taught alongside it. (x^3)^2 means x^3 . x^3, so write the repetition out explicitly. Students who can say "the outer exponent tells me how many copies" stop guessing between the two rules.',
    verify: ['Simplify (m^4)^3 by writing out the copies.', 'Which is larger, (2^3)^2 or 2^3 . 2^2?', 'Write (x^2)^5 as a repeated product.']
  },
  {
    id: 'M05',
    name: 'Distributes an exponent over a sum',
    short: '(a+b)^2 to a^2 + b^2',
    belief: 'Treats squaring as distributive across addition, dropping the cross term entirely.',
    reteach: 'Distribution is legal over multiplication and illegal over addition, and students have no felt difference between the two cases. Use area: a square of side (a+b) visibly contains two squares and two rectangles. The 2ab is a region on the page, not a term to memorise. Once seen geometrically it is hard to unsee.',
    verify: ['Expand (x+4)^2.', 'Test (a+b)^2 = a^2+b^2 with a=3, b=4.', 'Draw a square of side (a+b) and label all four regions.']
  },
  {
    id: 'M06',
    name: 'Adds numerators and denominators',
    short: '1/2 + 1/3 to 2/5',
    belief: 'Adds fractions componentwise, treating them as two independent whole numbers.',
    reteach: 'Estimation exposes this instantly: 1/2 + 1/3 must exceed 1/2, but 2/5 is smaller than 1/2, so the answer is wrong before any procedure is checked. Build the habit of bounding the answer first, then re-establish that only like units add -- thirds and halves are different units until renamed.',
    verify: ['Without computing, is 1/2 + 1/3 more or less than 1/2?', 'Add 2/3 + 1/4.', 'Why can 1/5 + 2/5 be added directly but 1/5 + 1/3 cannot?']
  },
  {
    id: 'M07',
    name: 'Negative sign not distributed across parentheses',
    short: '-(x-3) to -x-3',
    belief: 'Applies the leading minus to the first term only, leaving the remaining signs untouched.',
    reteach: 'Students read the minus as decoration on the first term rather than as multiplication by -1. Have them rewrite every leading minus as -1 times the bracket for a week, no shortcuts allowed. The distribution then follows from a rule they already trust instead of a new one.',
    verify: ['Simplify -(2y-5).', 'Rewrite -(a+b-c) as -1 times the bracket, then expand.', 'Check your answer to the first item at y=1.']
  },
  {
    id: 'M08',
    name: 'Subtracting a negative treated as subtracting',
    short: '5 - (-3) to 2',
    belief: 'Ignores the second minus sign, collapsing subtraction of a negative into ordinary subtraction.',
    reteach: 'Rules about "two negatives" get memorised and then misfire. Ground it on the number line instead: subtraction asks for distance and direction from -3 to 5, which is 8 to the right. Temperature or elevation works equally well. The sign rule should be the summary of a movement students can already picture.',
    verify: ['Compute -4 - (-9).', 'On a number line, how far is it from -3 up to 5?', 'The temperature rises from -6 to 2. What is the change?']
  },
  {
    id: 'M09',
    name: 'Illegal cancellation across addition',
    short: '(x+2)/2 to x+1 or x',
    belief: 'Cancels a denominator against one term of a sum in the numerator rather than against the whole numerator.',
    reteach: 'Cancelling is division, and division must reach every term. Splitting the fraction first -- (x+2)/2 = x/2 + 2/2 -- makes the requirement structural rather than a prohibition to remember. A numeric counterexample such as (4+2)/2 seals it: the answer is 3, not 5.',
    verify: ['Simplify (3x+6)/3 by splitting the fraction.', 'Test (x+2)/2 = x+1 at x=4.', 'Why can (2x)/2 be cancelled but (x+2)/2 cannot?']
  },
  {
    id: 'M10',
    name: 'Sign error moving a term across the equals sign',
    short: 'x+5=12 to x=17',
    belief: 'Moves a term to the other side without inverting its operation, applying the change to one side only.',
    reteach: 'Caused by teaching "move it over and flip the sign" as a gesture. Replace it with the operation performed on both sides, written on both sides, every step. Slower on the page, but the balance model is what actually generalises to inequalities and systems later.',
    verify: ['Solve y - 4 = 10 showing the operation on both sides.', 'Solve x + 5 = 12 and check by substitution.', 'Explain why x + 5 = 12 cannot give x = 17.']
  },
  {
    id: 'M11',
    name: 'Distributes a coefficient to only the first term',
    short: '2(x+3)=10 to 2x+3=10',
    belief: 'Multiplies the leading term inside the bracket and leaves the rest of the bracket unchanged.',
    reteach: 'Closely related to M07 and often the same student. Arrows drawn from the coefficient to every term inside the bracket, before any arithmetic, make the omission visible. Pair with an area model so the second product is a region rather than an afterthought.',
    verify: ['Expand 3(x-1) and mark an arrow to each term.', 'Solve 2(x+3)=10 and check by substitution.', 'Find the area of a rectangle with sides 2 and (x+3).']
  },
  {
    id: 'M12',
    name: 'Root of a sum equals sum of roots',
    short: 'sqrt(a^2+b^2) to a+b',
    belief: 'Distributes a square root across addition, so sqrt(9+16) becomes 3+4=7 instead of 5.',
    reteach: 'The same distribution error as M05 arriving from the other direction, and it is why Pythagorean answers come back wrong. Compute inside first, always: sqrt(9+16)=sqrt(25)=5. A 3-4-5 triangle drawn to scale shows immediately that the hypotenuse is not 7.',
    verify: ['Compute sqrt(9+16).', 'Does sqrt(a+b) = sqrt(a)+sqrt(b)? Test with a=9, b=16.', 'A right triangle has legs 6 and 8. Find the hypotenuse.']
  }
],

  items: [
  { id: 'Q01', topic: 'Exponents', stem: 'Evaluate 2^-3.',
    opts: [ {t:'1/8', c:true}, {t:'-8', mis:'M01'}, {t:'-6', mis:'M02'}, {t:'6', mis:'M02'} ] },
  { id: 'Q02', topic: 'Exponents', stem: 'Evaluate 5^-2.',
    opts: [ {t:'1/25', c:true}, {t:'-25', mis:'M01'}, {t:'-10', mis:'M02'}, {t:'1/10', mis:null} ] },
  { id: 'Q03', topic: 'Exponents', stem: 'Simplify x^2 . x^3.',
    opts: [ {t:'x^5', c:true}, {t:'x^6', mis:'M03'}, {t:'2x^5', mis:null}, {t:'x^23', mis:null} ] },
  { id: 'Q04', topic: 'Exponents', stem: 'Simplify a^5 . a^2.',
    opts: [ {t:'a^7', c:true}, {t:'a^10', mis:'M03'}, {t:'2a^7', mis:null}, {t:'a^52', mis:null} ] },
  { id: 'Q05', topic: 'Exponents', stem: 'Simplify (x^3)^2.',
    opts: [ {t:'x^6', c:true}, {t:'x^5', mis:'M04'}, {t:'x^9', mis:null}, {t:'2x^3', mis:null} ] },
  { id: 'Q06', topic: 'Exponents', stem: 'Simplify (m^4)^3.',
    opts: [ {t:'m^12', c:true}, {t:'m^7', mis:'M04'}, {t:'m^64', mis:null}, {t:'3m^4', mis:null} ] },
  { id: 'Q07', topic: 'Expanding', stem: 'Expand (a+b)^2.',
    opts: [ {t:'a^2+2ab+b^2', c:true}, {t:'a^2+b^2', mis:'M05'}, {t:'2a+2b', mis:'M02'}, {t:'a^2+ab+b^2', mis:null} ] },
  { id: 'Q08', topic: 'Expanding', stem: 'Expand (x+3)^2.',
    opts: [ {t:'x^2+6x+9', c:true}, {t:'x^2+9', mis:'M05'}, {t:'2x+6', mis:'M02'}, {t:'x^2+3x+9', mis:null} ] },
  { id: 'Q09', topic: 'Fractions', stem: 'Compute 1/2 + 1/3.',
    opts: [ {t:'5/6', c:true}, {t:'2/5', mis:'M06'}, {t:'1/5', mis:null}, {t:'3/5', mis:null} ] },
  { id: 'Q10', topic: 'Fractions', stem: 'Compute 2/3 + 1/4.',
    opts: [ {t:'11/12', c:true}, {t:'3/7', mis:'M06'}, {t:'3/12', mis:null}, {t:'2/12', mis:null} ] },
  { id: 'Q11', topic: 'Signs', stem: 'Simplify -(x-3).',
    opts: [ {t:'-x+3', c:true}, {t:'-x-3', mis:'M07'}, {t:'x-3', mis:null}, {t:'x+3', mis:null} ] },
  { id: 'Q12', topic: 'Signs', stem: 'Simplify -(2y-5)+y.',
    opts: [ {t:'-y+5', c:true}, {t:'-y-5', mis:'M07'}, {t:'-3y-5', mis:'M07'}, {t:'-3y+5', mis:null} ] },
  { id: 'Q13', topic: 'Signs', stem: 'Compute 5 - (-3).',
    opts: [ {t:'8', c:true}, {t:'2', mis:'M08'}, {t:'-2', mis:'M08'}, {t:'-8', mis:null} ] },
  { id: 'Q14', topic: 'Signs', stem: 'Compute -4 - (-9).',
    opts: [ {t:'5', c:true}, {t:'-13', mis:'M08'}, {t:'13', mis:null}, {t:'-5', mis:'M08'} ] },
  { id: 'Q15', topic: 'Fractions', stem: 'Simplify (x+2)/2.',
    opts: [ {t:'x/2 + 1', c:true}, {t:'x+1', mis:'M09'}, {t:'x', mis:'M09'}, {t:'x+2', mis:null} ] },
  { id: 'Q16', topic: 'Fractions', stem: 'Simplify (3x+6)/3.',
    opts: [ {t:'x+2', c:true}, {t:'3x+2', mis:'M09'}, {t:'x+6', mis:'M09'}, {t:'x+3', mis:null} ] },
  { id: 'Q17', topic: 'Equations', stem: 'Solve x + 5 = 12.',
    opts: [ {t:'x = 7', c:true}, {t:'x = 17', mis:'M10'}, {t:'x = -7', mis:null}, {t:'x = 12/5', mis:null} ] },
  { id: 'Q18', topic: 'Equations', stem: 'Solve y - 4 = 10.',
    opts: [ {t:'y = 14', c:true}, {t:'y = 6', mis:'M10'}, {t:'y = -6', mis:null}, {t:'y = 40', mis:null} ] },
  { id: 'Q19', topic: 'Equations', stem: 'Solve 2(x + 3) = 10.',
    opts: [ {t:'x = 2', c:true}, {t:'x = 3.5', mis:'M11'}, {t:'x = 8', mis:null}, {t:'x = 5', mis:null} ] },
  { id: 'Q20', topic: 'Equations', stem: 'Solve 3(x - 1) = 12.',
    opts: [ {t:'x = 5', c:true}, {t:'x = 13/3', mis:'M11'}, {t:'x = 3', mis:null}, {t:'x = 11', mis:null} ] },
  { id: 'Q21', topic: 'Roots', stem: 'Compute sqrt(9 + 16).',
    opts: [ {t:'5', c:true}, {t:'7', mis:'M12'}, {t:'25', mis:null}, {t:'12.5', mis:null} ] },
  { id: 'Q22', topic: 'Roots', stem: 'A right triangle has legs 6 and 8. Find the hypotenuse.',
    opts: [ {t:'10', c:true}, {t:'14', mis:'M12'}, {t:'100', mis:null}, {t:'48', mis:null} ] },

  /* Third probe for each misconception.
     Two items per misconception is not enough. The inference layer holds out
     one item at a time to check whether an item agrees with the rest of the
     test, and with only two probes that leaves a single item behind -- which by
     the model's own logic can never be conclusive. Three probes make every
     leave-one-out question answerable, and materially improve recall. */
  { id: 'Q23', topic: 'Exponents', stem: 'Evaluate 4^-1.',
    opts: [ {t:'1/4', c:true}, {t:'-4', mis:'M01'}, {t:'-1/4', mis:'M01'}, {t:'0.4', mis:null} ] },
  { id: 'Q24', topic: 'Exponents', stem: 'Evaluate 2^5.',
    opts: [ {t:'32', c:true}, {t:'10', mis:'M02'}, {t:'25', mis:null}, {t:'16', mis:null} ] },
  { id: 'Q25', topic: 'Exponents', stem: 'Simplify n^3 . n^4.',
    opts: [ {t:'n^7', c:true}, {t:'n^12', mis:'M03'}, {t:'2n^7', mis:null}, {t:'n^34', mis:null} ] },
  { id: 'Q26', topic: 'Exponents', stem: 'Simplify (t^2)^4.',
    opts: [ {t:'t^8', c:true}, {t:'t^6', mis:'M04'}, {t:'t^16', mis:null}, {t:'4t^2', mis:null} ] },
  { id: 'Q27', topic: 'Expanding', stem: 'Expand (2+y)^2.',
    opts: [ {t:'4+4y+y^2', c:true}, {t:'4+y^2', mis:'M05'}, {t:'2+2y', mis:'M02'}, {t:'4+2y+y^2', mis:null} ] },
  { id: 'Q28', topic: 'Fractions', stem: 'Compute 1/4 + 1/6.',
    opts: [ {t:'5/12', c:true}, {t:'2/10', mis:'M06'}, {t:'1/10', mis:null}, {t:'2/24', mis:null} ] },
  { id: 'Q29', topic: 'Signs', stem: 'Simplify -(3a-2b).',
    opts: [ {t:'-3a+2b', c:true}, {t:'-3a-2b', mis:'M07'}, {t:'3a-2b', mis:null}, {t:'3a+2b', mis:null} ] },
  { id: 'Q30', topic: 'Signs', stem: 'Compute 7 - (-2).',
    opts: [ {t:'9', c:true}, {t:'5', mis:'M08'}, {t:'-5', mis:'M08'}, {t:'-9', mis:null} ] },
  { id: 'Q31', topic: 'Fractions', stem: 'Simplify (5x+10)/5.',
    opts: [ {t:'x+2', c:true}, {t:'5x+2', mis:'M09'}, {t:'x+10', mis:'M09'}, {t:'x+5', mis:null} ] },
  { id: 'Q32', topic: 'Equations', stem: 'Solve m + 9 = 15.',
    opts: [ {t:'m = 6', c:true}, {t:'m = 24', mis:'M10'}, {t:'m = -6', mis:null}, {t:'m = 15/9', mis:null} ] },
  { id: 'Q33', topic: 'Equations', stem: 'Expand 4(x + 2).',
    opts: [ {t:'4x + 8', c:true}, {t:'4x + 2', mis:'M11'}, {t:'x + 8', mis:null}, {t:'4x + 6', mis:null} ] },
  { id: 'Q34', topic: 'Roots', stem: 'Compute sqrt(25 + 144).',
    opts: [ {t:'13', c:true}, {t:'17', mis:'M12'}, {t:'169', mis:null}, {t:'84.5', mis:null} ] },

  /* Two deliberately weak items. The item-analysis layer has to find these on
     its own -- nothing in the data marks them. Q35 is trivial and carries no
     information; Q36 is ambiguously worded, so responses are near-random
     regardless of how strong the student is. */
  { id: 'Q35', topic: 'Exponents', stem: 'Evaluate 5^1.',
    opts: [ {t:'5', c:true}, {t:'1', mis:null}, {t:'0', mis:null}, {t:'25', mis:null} ], _weak: 'trivial' },
  { id: 'Q36', topic: 'Expanding', stem: 'What is the value of the expression above?',
    opts: [ {t:'Cannot be determined', c:true}, {t:'0', mis:null}, {t:'1', mis:null}, {t:'x', mis:null} ], _weak: 'ambiguous' }
],

  archetypes: [
  {
    id: 'A',
    label: 'Exponent rules',
    blurb: 'Holds the two exponent rules but cannot tell them apart, and reads exponentiation as multiplication.',
    core: ['M02', 'M03', 'M04'],
    weight: 0.28
  },
  {
    id: 'B',
    label: 'Signs and negatives',
    blurb: 'Loses sign information across brackets, across the equals sign, and when subtracting a negative.',
    core: ['M07', 'M08', 'M10', 'M11'],
    weight: 0.29
  },
  {
    id: 'C',
    label: 'Illegal distribution',
    blurb: 'Distributes operations that do not distribute: exponents and roots over sums, denominators across terms.',
    core: ['M05', 'M06', 'M09', 'M12'],
    weight: 0.25
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
