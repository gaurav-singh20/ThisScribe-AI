import { useEffect, useRef } from "react";
import { Bot, User } from "lucide-react";

const ChatWindow = ({ messages, loading, pdfFile }) => {
  const bottomRef = useRef(null);
  const uploadedFileName = pdfFile
    ? decodeURIComponent(pdfFile.split("/").pop() || "")
    : "";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {uploadedFileName && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2 text-sm text-gray-200">
          <span className="font-medium">📄 {uploadedFileName}</span>
        </div>
      )}

      {messages.map((msg, i) => (
        <div
          key={i}
          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
        >
          {msg.role === "assistant" && (
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-1">
              <Bot size={16} />
            </div>
          )}
          <div
            className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-blue-600 text-white rounded-br-sm"
                : "bg-gray-700 text-gray-100 rounded-bl-sm"
            }`}
          >
            {msg.content}
          </div>
          {msg.role === "user" && (
            <div className="w-8 h-8 rounded-full bg-gray-600 flex items-center justify-center shrink-0 mt-1">
              <User size={16} />
            </div>
          )}
        </div>
      ))}

      {loading && (
        <div className="flex gap-3 justify-start">
          <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-1">
            <Bot size={16} />
          </div>
          <div className="bg-gray-700 text-gray-300 px-4 py-3 rounded-2xl rounded-bl-sm text-sm">
            <span className="animate-pulse">Thinking…</span>
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

export default ChatWindow;
