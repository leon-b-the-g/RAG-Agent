import { SpanStatusCode, trace, type Attributes } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';

/**
 * Tracing is on only when LANGFUSE_SECRET_KEY is set; otherwise every span is a no-op.
 * AI SDK calls (embedMany, generateText) emit their own spans via registerTelemetry and
 * nest under whatever span() is active, so one `pnpm ask` = one trace: ask > retrieve > embed, answer > llm.
 */
let processor: LangfuseSpanProcessor | undefined;
if (process.env.LANGFUSE_SECRET_KEY) {
  processor = new LangfuseSpanProcessor({ exportMode: 'immediate' }); // CLI runs are short-lived
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
  registerTelemetry(new OpenTelemetry({ usage: true, embedding: true }));
}

const tracer = trace.getTracer('rags2riches');

export function span<T>(name: string, attrs: Attributes, fn: () => Promise<T>): Promise<T> {
  return tracer.startActiveSpan(name, { attributes: attrs }, async (s) => {
    try {
      return await fn();
    } catch (e) {
      s.recordException(e as Error);
      s.setStatus({ code: SpanStatusCode.ERROR });
      throw e;
    } finally {
      s.end();
    }
  });
}

/** Call before process exit so the last spans reach Langfuse. */
export const flush = () => processor?.forceFlush() ?? Promise.resolve();
