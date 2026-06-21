import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";

export type EditorLanguage = "javascript" | "python" | "text";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  placeholder?: string;
  height?: string;
}

function extensionsFor(language: EditorLanguage) {
  if (language === "python") return [python()];
  if (language === "javascript")
    return [javascript({ jsx: true, typescript: true })];
  return [];
}

/**
 * Lazy-loaded CodeMirror editor for the trainee playground. Default export so it
 * can be wrapped in React.lazy() and kept out of the initial bundle.
 */
export default function CodeEditor({
  value,
  onChange,
  language = "javascript",
  readOnly = false,
  placeholder,
  height = "320px",
}: CodeEditorProps) {
  return (
    <CodeMirror
      value={value}
      height={height}
      readOnly={readOnly}
      placeholder={placeholder}
      extensions={extensionsFor(language)}
      onChange={(v) => onChange(v)}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        autocompletion: false,
      }}
      className="overflow-hidden rounded-md border border-border text-xs"
    />
  );
}
