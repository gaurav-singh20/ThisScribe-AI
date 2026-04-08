import { useState, useEffect, useRef } from "react";
import Sidebar from "./components/Sidebar";
import ChatHeader from "./components/ChatHeader";
import ChatWindow from "./components/ChatWindow";
import MessageInput from "./components/MessageInput";

const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error("Missing VITE_API_URL environment variable");
}

const App = () => {
  const [chatList, setChatList] = useState([]);
  const [currentChatId, setCurrentChatId] = useState(null);
  const [currentChat, setCurrentChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [selectedPdf, setSelectedPdf] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const uploadInputRef = useRef(null);

  // Load all chat sessions on mount
  useEffect(() => {
    fetchChatList();
  }, []);

  const fetchChatList = async () => {
    try {
      const res = await fetch(`${API_URL}/api/chat`);
      const data = await res.json();
      setChatList(data);
    } catch (err) {
      console.error("Failed to fetch chat list:", err);
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await fetch(`${API_URL}/api/chat/new`, { method: "POST" });
      const newChat = await res.json();
      setChatList((prev) => [newChat, ...prev]);
      setCurrentChatId(newChat._id);
      setCurrentChat(newChat);
      setMessages([]);
      setSelectedPdf(null);
      setScanError("");
    } catch (err) {
      console.error("Failed to create new chat:", err);
    }
  };

  const handleSelectChat = async (chatId) => {
    if (chatId === currentChatId) return;
    setCurrentChatId(chatId);
    setCurrentChat(null);
    setMessages([]);
    setSelectedPdf(null);
    setScanError("");
    try {
      const res = await fetch(`${API_URL}/api/chat/${chatId}`);
      const chat = await res.json();
      setCurrentChat(chat);
      setMessages(chat.messages || []);
    } catch (err) {
      console.error("Failed to load chat messages:", err);
    }
  };

  const handleDeleteChat = async (chatId) => {
    try {
      await fetch(`${API_URL}/api/chat/${chatId}`, { method: "DELETE" });
      setChatList((prev) => prev.filter((c) => c._id !== chatId));
      if (currentChatId === chatId) {
        setCurrentChatId(null);
        setCurrentChat(null);
        setMessages([]);
        setSelectedPdf(null);
        setScanError("");
      }
    } catch (err) {
      console.error("Failed to delete chat:", err);
    }
  };

  const handleSendMessage = async (content) => {
    const trimmedContent = content?.trim() || "";
    if (!trimmedContent || !currentChatId || loading) return;

    // Optimistically show user text messages while request is in flight.
    const startedAt = Date.now();
    const tempUserId = `temp-user-${startedAt}`;
    const tempAssistantId = `temp-assistant-${startedAt}`;

    const optimistic = {
      _id: tempUserId,
      role: "user",
      content: trimmedContent,
      timestamp: new Date().toISOString(),
    };
    const assistantPlaceholder = {
      _id: tempAssistantId,
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic, assistantPlaceholder]);

    const formData = new FormData();
    formData.append("message", trimmedContent); //not a json, but a multi-data, in case we have to send pdf+message together
    //Content-Type: application/json is not used here because we are sending formData, which automatically sets the content type to multipart/form-data, allowing us to send files if needed in the future without changing the request structure.
    setLoading(true);
    setThinking(false);

    try {
      const res = await fetch(`${API_URL}/api/chat/${currentChatId}/message`, {
        method: "POST",
        headers: { Accept: "text/event-stream" }, //stream tokens response
        body: formData, //formData contains the user message, which is sent to the server to generate a response in format "message": "your message".
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to send message");
      }

      if (!res.body) {
        throw new Error("Streaming response body is unavailable");
      }
      //Give me a tool (reader) that I can use to read the stream.
      const reader = res.body.getReader(); // for reading continues streaming tokens from req body but in binary, so we need to decode it to text
      const decoder = new TextDecoder();
      let buffer = "";
      let donePayload = null;

      while (true) {
        //Reading stream continuously, This loop runs until server closes the stream.
        const { value, done } = await reader.read(); //actual read happens here, read chunks one by one in each loop
        if (done) break; //stream closed by server, done: true means no more data to read

        buffer += decoder.decode(value, { stream: true }); //Adds the decoded text to the buffer.
        const events = buffer.split("\n\n"); //In Server Sent Events (SSE), each event ends with: \n\n, so we split the buffer into individual events. The last event may be incomplete, so we keep it in the buffer for the next read.
        buffer = events.pop() || "";

        for (const eventBlock of events) {
          const line = eventBlock
            .split("\n")
            .find((candidate) => candidate.startsWith("data:"));
          if (!line) continue;

          const raw = line.slice(5).trim();
          if (!raw) continue;

          let event;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          if (event.type === "token") {
            const token = event.token || "";
            if (!token) continue;

            setMessages((prev) =>
              prev.map((msg) =>
                msg._id === tempAssistantId
                  ? { ...msg, content: `${msg.content}${token}` }
                  : msg,
              ),
            );
          }

          if (event.type === "done") {
            donePayload = event;
          }

          if (event.type === "error") {
            throw new Error(event.error || "Streaming failed");
          }
        }
      }

      const data = donePayload;
      if (!data) {
        throw new Error("Streaming ended without completion payload");
      }

      if (data.userMessage || data.botMessage) {
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg._id === tempUserId && data.userMessage)
              return data.userMessage;
            if (msg._id === tempAssistantId && data.botMessage)
              return data.botMessage;
            return msg;
          }),
        );
      }

      setCurrentChat((prev) =>
        prev
          ? {
              ...prev,
              title: data.chatTitle ?? prev.title,
              pdfFile: data.pdfFile ?? prev.pdfFile,
            }
          : prev,
      );

      setChatList((prev) =>
        prev.map((c) =>
          c._id === currentChatId
            ? {
                ...c,
                title: data.chatTitle ?? c.title,
                pdfFile: data.pdfFile ?? c.pdfFile,
              }
            : c,
        ),
      );
    } catch (err) {
      console.error("Failed to send message:", err);
      setMessages((prev) =>
        prev.filter(
          (msg) => msg._id !== tempUserId && msg._id !== tempAssistantId,
        ),
      );
    } finally {
      setLoading(false);
      setThinking(false);
    }
  };

  const handleSelectPdf = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedPdf(file);
    setScanError("");
  };

  const handleScanDocument = async () => {
    if (!currentChatId || !selectedPdf || scanning) return;

    const formData = new FormData();
    formData.append("pdf", selectedPdf);

    setScanning(true);
    setScanError("");

    try {
      const res = await fetch(`${API_URL}/api/chat/${currentChatId}/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to scan document");
      }

      setCurrentChat((prev) =>
        prev
          ? {
              ...prev,
              pdfFile: data.pdfFile,
            }
          : prev,
      );

      setChatList((prev) =>
        prev.map((chat) =>
          chat._id === currentChatId
            ? {
                ...chat,
                pdfFile: data.pdfFile,
              }
            : chat,
        ),
      );

      setSelectedPdf(null);
    } catch (err) {
      console.error("Failed to scan document:", err);
      setScanError(err.message || "Failed to scan document");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="flex h-screen bg-gray-800 text-white overflow-hidden">
      <Sidebar
        chatList={chatList}
        currentChatId={currentChatId}
        onNewChat={handleNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <ChatHeader />
        {currentChatId ? (
          currentChat ? (
            currentChat.pdfFile ? (
              <>
                <ChatWindow
                  messages={messages}
                  loading={thinking}
                  pdfFile={currentChat?.pdfFile}
                />
                <MessageInput onSend={handleSendMessage} disabled={loading} />
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-6">
                <div className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900/70 p-6 text-center">
                  <h2 className="text-xl font-semibold text-white">
                    Upload Your Document
                  </h2>
                  <p className="mt-2 text-sm text-gray-400">
                    This chat will be dedicated to one PDF only.
                  </p>

                  {selectedPdf && (
                    <p className="mt-5 truncate text-sm text-gray-300">
                      Selected: {selectedPdf.name}
                    </p>
                  )}

                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={handleSelectPdf}
                    disabled={scanning}
                  />

                  {!selectedPdf ? (
                    <button
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={scanning}
                      className="mt-5 inline-flex rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      Upload PDF
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleScanDocument}
                      disabled={scanning}
                      className="mt-5 inline-flex rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {scanning ? "Scanning document..." : "Scan Document"}
                    </button>
                  )}

                  {scanError && (
                    <p className="mt-3 text-xs text-red-400">{scanError}</p>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-400">
              Loading chat...
            </div>
          )
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-gray-400 gap-3">
            <h1 className="text-2xl font-semibold text-white">
              Heya!! want a scribe to describe??
            </h1>
            <p className="text-sm">Select a chat or start a new one.</p>
            <button
              onClick={handleNewChat}
              className="mt-2 px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors text-sm font-medium"
            >
              New Chat
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
