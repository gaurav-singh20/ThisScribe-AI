import { Plus, MessageSquare, Trash2 } from "lucide-react";

const Sidebar = ({
  chatList,
  currentChatId,
  onNewChat,
  onSelectChat,
  onDeleteChat,
}) => {
  return (
    <div className="w-64 h-screen bg-gray-900 flex flex-col shrink-0 border-r border-gray-700">
      {/* Header */}
      <div className="p-3 border-b border-gray-700">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-600 hover:bg-gray-700 transition-colors text-sm font-medium text-gray-200"
        >
          <Plus size={16} />
          New Chat
        </button>
      </div>

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {chatList.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-8">
            No chats yet.
          </p>
        )}
        {chatList.map((chat) => (
          <div
            key={chat._id}
            onClick={() => onSelectChat(chat._id)}
            className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
              currentChatId === chat._id ? "bg-gray-700" : "hover:bg-gray-800"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare size={14} className="shrink-0 text-gray-400" />
              <span className="text-sm truncate text-gray-200">
                {chat.title || "New Chat"}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteChat(chat._id);
              }}
              title="Delete chat"
              className="opacity-0 group-hover:opacity-100 ml-1 shrink-0 text-gray-500 hover:text-red-400 transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
        ThisScribe
      </div>
    </div>
  );
};

export default Sidebar;
