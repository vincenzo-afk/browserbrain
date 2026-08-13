// BrowserBrain style reminder: the shell is intentionally quiet so the chat and context desk stay central.
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import Home from "./pages/Home";

export default function App() {
  return <ErrorBoundary><TooltipProvider><Toaster /><Home /></TooltipProvider></ErrorBoundary>;
}
