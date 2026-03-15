const ChatHeader = ({ chatTitle }) => {
  return (
    <div className="border-b border-gray-700 bg-gray-800/95 px-4 py-3">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-white">
            {chatTitle || "New Chat"}
          </h1>
          <p className="mt-1 text-xs text-gray-400">
            Ask questions about your scanned document.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatHeader;
