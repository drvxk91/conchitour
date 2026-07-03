// Minimal Web Speech API ambient types. TypeScript's lib.dom.d.ts ships
// SpeechRecognitionResult/ResultList/Alternative but omits the SpeechRecognition
// controller interface and SpeechRecognitionEvent itself — declared here for the
// dictation mic button in NewProjectWizard.tsx.

interface SpeechRecognitionEvent extends Event {
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

declare var SpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};

declare var webkitSpeechRecognition: {
  prototype: SpeechRecognition;
  new (): SpeechRecognition;
};
