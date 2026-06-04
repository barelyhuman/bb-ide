import { beforeAll, bench, describe } from "vitest";
import { getTimelineBenchmarkScenarios } from "../helpers/timeline-benchmark.js";

const scenarios = getTimelineBenchmarkScenarios();

describe("/timeline performance", () => {
  beforeAll(() => {
    for (const scenario of scenarios) {
      console.info(
        `[timeline] ${scenario.id} events=${scenario.eventCount} summaryEvents=${scenario.summaryEventCount} summaryBytes=${scenario.summaryBytes} fullBytes=${scenario.fullBytes}`,
      );
    }
  });

  for (const scenario of scenarios) {
    bench(`build summary ${scenario.id}`, () => {
      scenario.buildSummary();
    });

    bench(`build+serialize summary ${scenario.id}`, () => {
      scenario.buildAndSerializeSummary();
    });

    bench(`load summary stored rows ${scenario.id}`, () => {
      scenario.loadSummaryStoredRows();
    });

    bench(`load context window usage rows ${scenario.id}`, () => {
      scenario.loadContextWindowUsageRows();
    });

    bench(`compact summary events ${scenario.id}`, () => {
      scenario.compactSummaryEvents();
    });

    bench(`decode stored events ${scenario.id}`, () => {
      scenario.decodeStoredEvents();
    });

    bench(`build summary rows ${scenario.id}`, () => {
      scenario.buildSummaryRowsOnly();
    });
  }
});
