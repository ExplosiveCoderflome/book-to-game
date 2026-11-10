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

/** Server-owned review; optional receipt callback runs before releasing the durable lock. */
export function createExtensionReviewer(counterPort: ExtensionRejectionCounterPort, record?: (result: ExtensionReviewResult) => void) {
  return {
    review(scope: string, revision: WorldRevision, options?: SimulationOptions): Promise<ExtensionReviewResult> {
      if (!scope.trim()) throw new Error('server-owned extension review scope required');
      // Snapshot before waiting for a competing request's lock.
      const candidate = structuredClone(revision);
      return counterPort.withReview(scope, async counter => {
        const previous = await counter.read();
        if (!Number.isSafeInteger(previous) || previous < 0) throw new Error('invalid persisted extension rejection count');
        const finish = (result: ExtensionReviewResult) => {record?.(result); return result;};
        if (previous >= 3) return finish({status: 'hardfail', passed: false, rejections: previous,
          issues: [{severity: 'error', code: 'extension.hardfail', message: '三轮扩展审查均被驳回，已最终拒绝；需要人工处理，不能更换扩展ID或版本重置'}]});
        const issues: ExtensionIssue[] = [];
        // Every parseable declaration runs ALL its cases, even if coverage or an earlier case fails.
        const declarations = candidate.content.extensions;
        if (Object.hasOwn(candidate.content, 'extensions') && !Array.isArray(declarations))
          issues.push({severity: 'error', code: 'extension.declaration', message: 'extensions 必须是扩展声明数组'});
        for (const declaration of Array.isArray(declarations) ? declarations : []) {
          const tests = await extensionTests(declaration, candidate.content);
          issues.push(...tests.issues);
          if (!Array.isArray(declaration?.tests) || tests.passed !== declaration.tests.length || tests.passed < 3) {
            issues.push({severity: 'error', code: 'extension.test-count', extensionId: declaration?.id,
              message: 'all declared tests (at least three) must execute and pass before simulation'});
          }
        }
        let simulation: SimulationCheck | undefined;
        if (!issues.length) {
          // Reuse the existing simulator and sandbox. Never forward caller rewriteRound.
          simulation = await checkWorldExtensions(candidate, 0, options);
          issues.push(...simulation.issues);
        }
        if (!issues.length) return finish({status: 'pass', passed: true, rejections: previous, issues, simulation});
        const rejections = await counter.increment();
        if (rejections !== previous + 1) throw new Error('extension rejection counter must increment exactly once');
        return finish({status: rejections >= 3 ? 'hardfail' : 'rewrite', passed: false, rejections, issues, simulation});
      });
    },
  };
}
