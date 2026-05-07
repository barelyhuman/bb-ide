import { ToolCallDetailBlock } from "./index";

export default {
  title: "Thread Timeline/ToolCallDetailBlock",
};

export function ToolCalls() {
  return (
    <div className="flex max-w-4xl flex-col gap-4 bg-background p-6 text-foreground">
      <ToolCallDetailBlock
        toolName="web.run"
        args={{
          search_query: [{ q: "OpenAI API documentation responses API" }],
        }}
        output="Found 4 results from official documentation."
      />
      <ToolCallDetailBlock
        toolName="functions.exec_command"
        args={{
          cmd: "git status --short",
          workdir: "/workspace/bb",
        }}
        output="M apps/app/src/components/thread-timeline/ThreadTimelineRows.tsx"
        streaming
      />
      <ToolCallDetailBlock toolName="image_gen.imagegen" args={null} output="" />
      <ToolCallDetailBlock
        toolName="api.threads.messages"
        args={{
          endpoint: "/v1/threads/thr_8sk2/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer …",
          },
          body: {
            role: "user",
            content: [
              {
                type: "text",
                text: "Summarize the timeline refactor plan",
              },
            ],
            metadata: {
              session_id: "ses_91kf2",
              client_version: "0.42.1",
            },
          },
        }}
        output={`{
  "id": "msg_4hgk2",
  "thread_id": "thr_8sk2",
  "created_at": 1746460800,
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "Here is a summary of the timeline refactor plan: we are unifying the tool detail and command detail blocks under a single visual envelope, dropping the redundant 'Tool: <name>' header and the 'Arguments' / 'Output' eyebrows, and matching the monospace text envelope used by the terminal block. The goal is design consistency across all expandable timeline rows."
    }
  ],
  "usage": {
    "input_tokens": 1284,
    "output_tokens": 96,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 1024
  }
}`}
      />
    </div>
  );
}
