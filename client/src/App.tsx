// BrowserBrain style reminder: the shell is intentionally quiet so the chat and context desk stay central.
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";

export default function App() {
  return <ErrorBoundary><Home /></ErrorBoundary>;
}
