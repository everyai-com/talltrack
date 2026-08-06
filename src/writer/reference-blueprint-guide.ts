import {
  GENERATED_LINKEDIN_REFERENCE_BLUEPRINTS,
  type GeneratedLinkedInReferenceBlueprint,
} from './reference-blueprints'

/**
 * Callcraft's compiled reference corpus is intentionally structural. The raw
 * creator posts stay source-only; this is the safe runtime artifact: no copied
 * wording, facts, names, offers, or attribution can leak into a TallTrack
 * prompt.
 */
export type ReferenceBlueprint = GeneratedLinkedInReferenceBlueprint

export const REFERENCE_BLUEPRINT_CATALOG = `
============================================================
CALLCRAFT STRUCTURAL BLUEPRINT CATALOG
============================================================
These are abstract shapes learned from the private Callcraft reference
corpus. They are not source material. Use the call transcripts for every fact,
number, name, quote, and claim. Choose exactly ONE blueprint for each post;
never blend two. If the material cannot fund its beats, choose a plainer shape
or return no post.

${GENERATED_LINKEDIN_REFERENCE_BLUEPRINTS.map((blueprint) => renderBlueprintLine(blueprint)).join('\n')}`.trim()

export function getReferenceBlueprint(id: string | undefined): ReferenceBlueprint | undefined {
  if (!id) return undefined
  return GENERATED_LINKEDIN_REFERENCE_BLUEPRINTS.find((blueprint) => blueprint.id === id)
}

/** A compact, deterministic fallback when the FIND phase omits or mistypes an id. */
export function fallbackReferenceBlueprint(story: { tension: string; material: string }): ReferenceBlueprint {
  const text = `${story.tension} ${story.material}`.toLowerCase()
  const preferredFit = text.includes('objection') || text.includes('concern') || text.includes('pushback')
    ? 'objection-dialogue'
    : text.includes('process') || text.includes('handoff') || text.includes('step')
      ? 'sales-process'
      : text.includes('decision') || text.includes('choose') || text.includes('tradeoff')
        ? 'buyer-decision'
        : undefined

  return (
    GENERATED_LINKEDIN_REFERENCE_BLUEPRINTS.find((blueprint) => blueprint.callFit === preferredFit) ??
    GENERATED_LINKEDIN_REFERENCE_BLUEPRINTS.find((blueprint) => blueprint.direction === 'story') ??
    GENERATED_LINKEDIN_REFERENCE_BLUEPRINTS[0]!
  )
}

export function renderSelectedBlueprint(blueprint: ReferenceBlueprint): string {
  return `
============================================================
SELECTED BLUEPRINT — LOCK THIS SHAPE
============================================================
id: ${blueprint.id}
direction: ${blueprint.direction}
hook mechanism: ${blueprint.hookMechanism}
tension mechanism: ${blueprint.tensionMechanism}
turn mechanism: ${blueprint.turnMechanism}
beat map: ${blueprint.beatMap.join(' → ')}
body movement: ${blueprint.bodyMovement}
evidence role: ${blueprint.evidenceRole}
ending move: ${blueprint.endingMove}
paragraph rhythm: ${blueprint.paragraphRhythm}
target length: approximately ${blueprint.targetWords} words
specificity to earn from the calls: ${blueprint.specificitySlots.join(', ') || 'the concrete material'}

Follow these beats in order. Every beat must be funded by the transcripts.
The shape may be shorter when the material is thin, but never pad it. Do not
borrow the reference creators' wording, facts, personality, offers, or CTA.
The post should feel native to the author, not like a template pasted over a
call.`.trim()
}

function renderBlueprintLine(blueprint: ReferenceBlueprint): string {
  return [
    blueprint.id,
    `fit=${blueprint.callFit}`,
    `direction=${blueprint.direction}`,
    `hook=${blueprint.hookMechanism}`,
    `tension=${blueprint.tensionMechanism}`,
    `turn=${blueprint.turnMechanism}`,
    `beats=${blueprint.bodyMovement}`,
    `evidence=${blueprint.evidenceRole}`,
    `ending=${blueprint.endingMove}`,
    `rhythm=${blueprint.paragraphRhythm}`,
    `target=${blueprint.targetWords}`,
    `slots=${blueprint.specificitySlots.join(', ') || 'concrete material'}`,
  ].join(' | ')
}
