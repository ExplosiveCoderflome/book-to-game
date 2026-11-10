import type { WorldRevision } from '@novel-game/contracts';
import { extensionTests, type ExtensionIssue } from '@novel-game/play-runtime';
import { checkWorldExtensions } from '@novel-game/play-runtime/sim';

type SimulationOptions = Parameters<typeof checkWorldExtensions>[2];
type SimulationCheck = Awaited<ReturnType<typeof checkWorldExtensions>>;

/** Implement in server persistence. Serialize the ENTIRE callback for a stable server-owned scope.
 * read/increment must be durable, atomic and monotonic across requests/processes/restarts.
 * Never derive scope from extension id/version/hash, request rewriteRound, or a model-supplied id.
 * No reset operation is exposed. Failed increment/read must throw (fail closed).
 */
export interface ExtensionRejectionCounterPort {
  withReview<T>(scope: string, work: (counter: {
    read(): Promise<number>;
    increment(): Promise<number>;
  }) => Promise<T>): Promise<T>;
}

export interface ExtensionReviewResult {
  status: 'pass' | 'rewrite' | 'hardfail';
  passed: boolean;
  rejections: number;
  issues: ExtensionIssue[];
  simulation?: SimulationCheck;
}

/** Author/publish use case, deliberately not wired into worlds/gate by this slice. */
export function createExtensionReviewer(counterPort: ExtensionRejectionCounterPort) {
  return {
    review(scope: string, revision: WorldRevision, options?: SimulationOptions): Promise<ExtensionReviewResult> {
      if (!scope.trim()) throw new Error('server-owned extension review scope required');
      // Snapshot before waiting for a competing request's lock.
      const candidate = structuredClone(revision);
      return counterPort.withReview(scope, async counter => {
        const previous = await counter.read();
        if (!Number.isSafeInteger(previous) || previous < 0) throw new Error('invalid persisted extension rejection count');
        if (previous >= 3) return {status: 'hardfail', passed: false, rejections: previous,
          issues: [{severity: 'error', code: 'extension.hardfail', message: 'three rejected reviews; human handoff required'}]};
        const issues: ExtensionIssue[] = [];
        // Every parseable declaration runs ALL its cases, even if coverage or an earlier case fails.
        for (const declaration of candidate.content.extensions ?? []) {
          const tests = await extensionTests(declaration, candidate.content);
          issues.push(...tests.issues);
          if (!Array.isArray(declaration.tests) || tests.passed !== declaration.tests.length || tests.passed < 3) {
            issues.push({severity: 'error', code: 'extension.test-count', extensionId: declaration.id,
              message: 'all declared tests (at least three) must execute and pass before simulation'});
          }
        }
        let simulation: SimulationCheck | undefined;
        if (!issues.length) {
          // Reuse the existing simulator and sandbox. Never forward caller rewriteRound.
          simulation = await checkWorldExtensions(candidate, 0, options);
          issues.push(...simulation.issues);
        }
        if (!issues.length) return {status: 'pass', passed: true, rejections: previous, issues, simulation};
        const rejections = await counter.increment();
        if (rejections !== previous + 1) throw new Error('extension rejection counter must increment exactly once');
        return {status: rejections >= 3 ? 'hardfail' : 'rewrite', passed: false, rejections, issues, simulation};
      });
    },
  };
}
