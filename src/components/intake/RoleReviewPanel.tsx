import { Plus, X } from "lucide-react";
import {
  DELIVERED_TO_OPTIONS,
  type CanonicalRole,
  type DeliveredTo,
} from "@/lib/generation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface RoleReviewPanelProps {
  value: CanonicalRole;
  onChange: (next: CanonicalRole) => void;
}

/** Editable form over the canonical role shape. Fully controlled. */
export function RoleReviewPanel({ value, onChange }: RoleReviewPanelProps) {
  function set<K extends keyof CanonicalRole>(key: K, v: CanonicalRole[K]) {
    onChange({ ...value, [key]: v });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="role-title">Title</Label>
          <Input
            id="role-title"
            value={value.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="AI Application Developer"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="role-family">Family</Label>
          <Input
            id="role-family"
            value={value.role_family}
            onChange={(e) => set("role_family", e.target.value)}
            placeholder="Application Engineering"
          />
        </div>
      </div>

      {/* Primary stack (chips) */}
      <ChipList
        label="Primary stack"
        items={value.primary_stack}
        placeholder="Add a technology…"
        onChange={(items) => set("primary_stack", items)}
      />

      {/* Responsibilities (list) */}
      <StringList
        label="Responsibilities"
        items={value.responsibilities}
        placeholder="A responsibility the trainee must perform"
        onChange={(items) => set("responsibilities", items)}
      />

      {/* Skill matrix */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Skill matrix</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              set("skill_matrix", [
                ...value.skill_matrix,
                { skill_area: "", delivered_to: "Supervised" },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add skill
          </Button>
        </div>
        <div className="space-y-2">
          {value.skill_matrix.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className="flex-1"
                value={row.skill_area}
                placeholder="Skill area"
                onChange={(e) => {
                  const next = [...value.skill_matrix];
                  next[i] = { ...row, skill_area: e.target.value };
                  set("skill_matrix", next);
                }}
              />
              <Select
                value={row.delivered_to}
                onValueChange={(v) => {
                  const next = [...value.skill_matrix];
                  next[i] = { ...row, delivered_to: v as DeliveredTo };
                  set("skill_matrix", next);
                }}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERED_TO_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  set(
                    "skill_matrix",
                    value.skill_matrix.filter((_, j) => j !== i),
                  )
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {value.skill_matrix.length === 0 && (
            <p className="text-sm text-muted-foreground">No skills yet.</p>
          )}
        </div>
      </div>

      {/* Milestones */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Milestones</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              set("milestones", [
                ...value.milestones,
                { name: "", indicator: "" },
              ])
            }
          >
            <Plus className="h-4 w-4" /> Add milestone
          </Button>
        </div>
        <div className="space-y-2">
          {value.milestones.map((row, i) => (
            <div key={i} className="flex items-start gap-2">
              <Input
                className="w-1/3"
                value={row.name}
                placeholder="Milestone"
                onChange={(e) => {
                  const next = [...value.milestones];
                  next[i] = { ...row, name: e.target.value };
                  set("milestones", next);
                }}
              />
              <Textarea
                className="flex-1 min-h-9"
                value={row.indicator}
                placeholder="Observable indicator"
                onChange={(e) => {
                  const next = [...value.milestones];
                  next[i] = { ...row, indicator: e.target.value };
                  set("milestones", next);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() =>
                  set(
                    "milestones",
                    value.milestones.filter((_, j) => j !== i),
                  )
                }
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {value.milestones.length === 0 && (
            <p className="text-sm text-muted-foreground">No milestones yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Small helpers ----------------------------------------------------------

function ChipList({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 rounded-full bg-mist px-2.5 py-1 text-xs font-medium text-foreground"
          >
            {item || "—"}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <ChipInput placeholder={placeholder} onAdd={(v) => onChange([...items, v])} />
    </div>
  );
}

function ChipInput({
  placeholder,
  onAdd,
}: {
  placeholder: string;
  onAdd: (v: string) => void;
}) {
  return (
    <Input
      placeholder={placeholder}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const v = e.currentTarget.value.trim();
          if (v) {
            onAdd(v);
            e.currentTarget.value = "";
          }
        }
      }}
    />
  );
}

function StringList({
  label,
  items,
  placeholder,
  onChange,
}: {
  label: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...items, ""])}
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              className="flex-1"
              value={item}
              placeholder={placeholder}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground">None yet.</p>
        )}
      </div>
    </div>
  );
}
