import { useState } from "react";
import { SendHorizontal } from "lucide-react";

const MessageInput = ({ onSend, disabled }) => {
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-4 border-t border-gray-700">
      <div className="flex items-end gap-2 bg-gray-700 rounded-xl px-4 py-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Send a message…"
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-white placeholder-gray-400 resize-none outline-none text-sm py-1 max-h-32"
          style={{ minHeight: "24px" }}
        />
        <button
          onClick={handleSend}
          disabled={disabled || !input.trim()}
          className="text-blue-400 hover:text-blue-300 disabled:text-gray-600 transition-colors pb-1 shrink-0"
        >
          <SendHorizontal size={18} />
        </button>
      </div>
      <p className="text-xs text-gray-500 text-center mt-2">
        Enter to send · Shift+Enter for new line
      </p>
    </div>
  );
};

export default MessageInput;
