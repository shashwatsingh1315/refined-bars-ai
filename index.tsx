console.log("index.tsx STARTS");
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { InterviewProvider } from './context/InterviewContext';

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error("Could not find root element");
  throw new Error("Could not find root element to mount to");
}

console.log("Found root element, attempting to render");
const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <InterviewProvider>
      <App />
    </InterviewProvider>
  </React.StrictMode>
);
console.log("Render call completed");