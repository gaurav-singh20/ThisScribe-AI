const ChatHeader = () => {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-700 bg-gray-900/95 px-4 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <img
          src="/logo.png"
          alt="TS logo"
          className="h-8 w-8 rounded-md border border-blue-400/40"
        />
        <h1 className="text-lg font-semibold tracking-wide text-white">
          ThisScribe
        </h1>
      </div>
    </header>
  );
};

export default ChatHeader;
