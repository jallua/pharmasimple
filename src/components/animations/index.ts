// site/src/components/animations/index.ts
//
// Animation registry (Task 6). Content (Markdown) and animation code (Astro
// components) are decoupled through a string `animationKey`: a drug's media
// entry names an animation, and this registry maps that name to the component
// that draws it.
//
// The two BeiGene sample animations are registered below (Task 9). A drug's
// media entry references one of these keys (`btk-inhibitor` / `pd1-checkpoint`)
// and MechanismMedia renders the matching component only when the key resolves
// here AND the media is `status: 'ready'`. Any other key still falls back to an
// accessible placeholder — correctness property P6: an animation is rendered
// only when its key resolves in the registry, so a mismatched animation can
// never appear.

// Type-only import: erased at build/test time (verbatimModuleSyntax), so the
// type never couples the runtime to Astro internals.
import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import BtkInhibitor from './BtkInhibitor.astro';
import Pd1Checkpoint from './Pd1Checkpoint.astro';
import Glp1Agonist from './Glp1Agonist.astro';
import TnfInhibitor from './TnfInhibitor.astro';
import FactorXaInhibitor from './FactorXaInhibitor.astro';
import Her2Antibody from './Her2Antibody.astro';
import BcrAblInhibitor from './BcrAblInhibitor.astro';
import Il4Il13Inhibitor from './Il4Il13Inhibitor.astro';
import Cdk46Inhibitor from './Cdk46Inhibitor.astro';
import Sglt2Inhibitor from './Sglt2Inhibitor.astro';
import HivIntegrase from './HivIntegrase.astro';
import AndrogenReceptorInhibitor from './AndrogenReceptorInhibitor.astro';
import VegfrInhibitor from './VegfrInhibitor.astro';
import CgrpInhibitor from './CgrpInhibitor.astro';
import Il6Inhibitor from './Il6Inhibitor.astro';
import IgaBudesonide from './IgaBudesonide.astro';
import IntegrinBlocker from './IntegrinBlocker.astro';
import DopamineStabilizer from './DopamineStabilizer.astro';
import EgfrInhibitor from './EgfrInhibitor.astro';
import PdL1Checkpoint from './PdL1Checkpoint.astro';
import AlkInhibitor from './AlkInhibitor.astro';
import HdacInhibitor from './HdacInhibitor.astro';
import Statin from './Statin.astro';
import Il23Inhibitor from './Il23Inhibitor.astro';
import CftrModulator from './CftrModulator.astro';
import MrnaVaccine from './MrnaVaccine.astro';
import SirnaSilencer from './SirnaSilencer.astro';
import AntisenseOligo from './AntisenseOligo.astro';
import Vmat2Inhibitor from './Vmat2Inhibitor.astro';
import ParpInhibitor from './ParpInhibitor.astro';
import Ppi from './Ppi.astro';
import Ccb from './Ccb.astro';
import BetaLactam from './BetaLactam.astro';
import Insulin from './Insulin.astro';
import PgaGlaucoma from './PgaGlaucoma.astro';
import Beta2Agonist from './Beta2Agonist.astro';
import AlphaGlucosidase from './AlphaGlucosidase.astro';
import AspirinCox from './AspirinCox.astro';
import GabaAnesthetic from './GabaAnesthetic.astro';
import AceInhibitor from './AceInhibitor.astro';
import Biguanide from './Biguanide.astro';
import ConjugateVaccine from './ConjugateVaccine.astro';
import ViralVectorVaccine from './ViralVectorVaccine.astro';
import VasopressinV2 from './VasopressinV2.astro';
import Prostacyclin from './Prostacyclin.astro';
import IdhInhibitor from './IdhInhibitor.astro';
import AntiFgf23 from './AntiFgf23.astro';
import Retinoid from './Retinoid.astro';
import Serd from './Serd.astro';
import SodiumChannelBlocker from './SodiumChannelBlocker.astro';
import AtypicalAntipsychotic from './AtypicalAntipsychotic.astro';
import GCsf from './GCsf.astro';
import Progestin from './Progestin.astro';
import CortisolSynthesisInhibitor from './CortisolSynthesisInhibitor.astro';
import ClottingFactor from './ClottingFactor.astro';
import Immunoglobulin from './Immunoglobulin.astro';
import Asparaginase from './Asparaginase.astro';
import Antihistamine from './Antihistamine.astro';
import Thrombolytic from './Thrombolytic.astro';
import CnpAnalog from './CnpAnalog.astro';
import TnfDecoyReceptor from './TnfDecoyReceptor.astro';
import TnfPegylatedFab from './TnfPegylatedFab.astro';
import EgfrMab from './EgfrMab.astro';
import GipGlp1Coagonist from './GipGlp1Coagonist.astro';
import Il1223Inhibitor from './Il1223Inhibitor.astro';
import Her2Adc from './Her2Adc.astro';
import Il13Inhibitor from './Il13Inhibitor.astro';
import Pd1CheckpointFcSilent from './Pd1CheckpointFcSilent.astro';

/**
 * The animation registry: `animationKey` -> original Astro animation component.
 * Add new sample animations here; `AnimationKey` narrows automatically.
 */
export const animations = {
  'btk-inhibitor': BtkInhibitor,
  'pd1-checkpoint': Pd1Checkpoint,
  'glp1-agonist': Glp1Agonist,
  'tnf-inhibitor': TnfInhibitor,
  'factor-xa-inhibitor': FactorXaInhibitor,
  'her2-antibody': Her2Antibody,
  'bcr-abl-inhibitor': BcrAblInhibitor,
  'il4-13-inhibitor': Il4Il13Inhibitor,
  'cdk46-inhibitor': Cdk46Inhibitor,
  'sglt2-inhibitor': Sglt2Inhibitor,
  'hiv-integrase': HivIntegrase,
  'androgen-receptor-inhibitor': AndrogenReceptorInhibitor,
  'vegfr-inhibitor': VegfrInhibitor,
  'cgrp-inhibitor': CgrpInhibitor,
  'il6-inhibitor': Il6Inhibitor,
  'iga-budesonide': IgaBudesonide,
  'integrin-blocker': IntegrinBlocker,
  'dopamine-stabilizer': DopamineStabilizer,
  'egfr-inhibitor': EgfrInhibitor,
  'pd-l1-checkpoint': PdL1Checkpoint,
  'alk-inhibitor': AlkInhibitor,
  'hdac-inhibitor': HdacInhibitor,
  'statin': Statin,
  'il23-inhibitor': Il23Inhibitor,
  'cftr-modulator': CftrModulator,
  'mrna-vaccine': MrnaVaccine,
  'sirna-silencer': SirnaSilencer,
  'antisense-oligo': AntisenseOligo,
  'vmat2-inhibitor': Vmat2Inhibitor,
  'parp-inhibitor': ParpInhibitor,
  'ppi': Ppi,
  'ccb': Ccb,
  'blactam': BetaLactam,
  'insulin': Insulin,
  'prostaglandin-glaucoma': PgaGlaucoma,
  'beta2-agonist': Beta2Agonist,
  'alpha-glucosidase': AlphaGlucosidase,
  'aspirin-cox': AspirinCox,
  'gaba-anesthetic': GabaAnesthetic,
  'ace-inhibitor': AceInhibitor,
  'biguanide': Biguanide,
  'conjugate-vaccine': ConjugateVaccine,
  'viral-vector-vaccine': ViralVectorVaccine,
  'vasopressin-v2': VasopressinV2,
  'prostacyclin': Prostacyclin,
  'idh-inhibitor': IdhInhibitor,
  'anti-fgf23': AntiFgf23,
  'retinoid': Retinoid,
  'serd': Serd,
  'sodium-channel-blocker': SodiumChannelBlocker,
  'atypical-antipsychotic': AtypicalAntipsychotic,
  'gcsf': GCsf,
  'progestin': Progestin,
  'cortisol-synthesis-inhibitor': CortisolSynthesisInhibitor,
  'clotting-factor': ClottingFactor,
  'immunoglobulin': Immunoglobulin,
  'asparaginase': Asparaginase,
  'antihistamine': Antihistamine,
  'thrombolytic': Thrombolytic,
  'cnp-analog': CnpAnalog,
  'tnf-decoy-receptor': TnfDecoyReceptor,
  'tnf-pegylated-fab': TnfPegylatedFab,
  'egfr-mab': EgfrMab,
  'gip-glp1-coagonist': GipGlp1Coagonist,
  'il12-23-inhibitor': Il1223Inhibitor,
  'her2-adc': Her2Adc,
  'il13-inhibitor': Il13Inhibitor,
  'pd1-checkpoint-fc-silent': Pd1CheckpointFcSilent,
} satisfies Record<string, AstroComponentFactory>;

/** Union of registered animation keys (`never` while the registry is empty). */
export type AnimationKey = keyof typeof animations;

/**
 * Type guard: true only when `key` names a registered animation. `MechanismMedia`
 * uses this to choose between the real animation and the placeholder fallback —
 * it never renders a mismatched animation (P6).
 */
export const hasAnimation = (key?: string): key is AnimationKey =>
  typeof key === 'string' && Object.prototype.hasOwnProperty.call(animations, key);

/**
 * Resolve the animation component for a key, or `undefined` when the key is not
 * registered. Convenience wrapper so callers never index the registry directly.
 */
export function getAnimation(key?: string): AstroComponentFactory | undefined {
  return hasAnimation(key)
    ? (animations as Record<string, AstroComponentFactory>)[key]
    : undefined;
}
