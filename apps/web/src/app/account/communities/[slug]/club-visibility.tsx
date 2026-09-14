"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex-generated-api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, SectionHeading } from "@/components/ui/card";
import { CheckboxField, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  ClubAccessNotice,
  useClubWorkspace,
  type WorkspaceData,
} from "./club-workspace";
import { categoryLabels } from "./club-workspace-model";

type Category = keyof typeof categoryLabels;
type VisibilityInput = {
  category: Category;
  audience: "public" | "staff" | "owner";
  staffRoleIds: Id<"communityRoles">[] | null;
};
type Save = (input: VisibilityInput) => Promise<unknown>;

function VisibilityRow({
  category,
  value,
  roles,
  save,
}: {
  category: Category;
  value: Omit<VisibilityInput, "category">;
  roles: WorkspaceData["roles"];
  save: Save;
}) {
  const [audience, setAudience] = useState(value.audience);
  const [selected, setSelected] = useState(value.staffRoleIds);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const changed =
    audience !== value.audience ||
    JSON.stringify(selected) !== JSON.stringify(value.staffRoleIds);
  return (
    <tr className="grid gap-3 border-b border-border py-5 align-top sm:table-row sm:py-0">
      <th scope="row" className="text-left text-sm font-medium sm:py-5 sm:pr-5">
        {categoryLabels[category]}
      </th>
      <td className="min-w-0 sm:min-w-44 sm:py-4 sm:pr-4">
        <Select
          aria-label={`${categoryLabels[category]} audience`}
          disabled={busy}
          value={audience}
          onChange={(event) => {
            setAudience(event.target.value as typeof audience);
            setMessage(null);
          }}
        >
          {category !== "individual_membership_history" ? (
            <option value="public">Public</option>
          ) : null}
          <option value="staff">Selected staff</option>
          <option value="owner">Owner only</option>
        </Select>
      </td>
      <td className="min-w-0 sm:min-w-52 sm:py-4 sm:pr-4">
        {audience === "staff" ? (
          <fieldset className="grid gap-2">
            <legend className="sr-only">
              {categoryLabels[category]} eligible staff
            </legend>
            <CheckboxField
              disabled={busy}
              checked={selected === null}
              onChange={(event) =>
                setSelected(event.target.checked ? null : [])
              }
            >
              All staff
            </CheckboxField>
            {roles.map((role) => (
              <CheckboxField
                key={role._id}
                disabled={busy || selected === null}
                checked={selected?.includes(role._id) ?? false}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...(current ?? []), role._id]
                      : (current ?? []).filter((id) => id !== role._id),
                  )
                }
              >
                {role.label}
              </CheckboxField>
            ))}
          </fieldset>
        ) : (
          <p className="hidden py-3 text-sm text-muted sm:block">
            Not applicable
          </p>
        )}
      </td>
      <td className="sm:py-4">
        <Button
          disabled={
            busy ||
            !changed ||
            (audience === "staff" && selected !== null && selected.length === 0)
          }
          onClick={async () => {
            setBusy(true);
            setMessage(null);
            try {
              await save({
                category,
                audience,
                staffRoleIds: audience === "staff" ? selected : null,
              });
              setError(false);
              setMessage("Saved.");
            } catch (cause) {
              setError(true);
              setMessage(
                cause instanceof Error
                  ? cause.message
                  : "Unable to save changes.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Save
        </Button>
        {message ? (
          <p
            className={`mt-2 max-w-44 text-xs ${error ? "text-danger" : "text-muted"}`}
            role={error ? "alert" : "status"}
          >
            {message}
          </p>
        ) : null}
      </td>
    </tr>
  );
}

export function ClubVisibilityView({
  data,
  save,
}: {
  data: WorkspaceData;
  save: Save;
}) {
  if (data.actor.kind !== "owner" || !data.visibility)
    return <ClubAccessNotice />;
  return (
    <div className="grid gap-6">
      <h1 className="text-3xl font-semibold tracking-tight">Data visibility</h1>
      <Card padding="lg" className="min-w-0">
        <SectionHeading description="Owner-controlled. Public settings apply to community pages and public APIs.">
          Who can see each category
        </SectionHeading>
        <div className="relative mt-5 overflow-x-auto">
          <table className="block w-full sm:table">
            <thead className="hidden sm:table-header-group">
              <tr className="border-b border-border text-left text-xs text-muted">
                <th scope="col" className="pb-3">
                  Information
                </th>
                <th scope="col" className="pb-3">
                  Audience
                </th>
                <th scope="col" className="pb-3">
                  Eligible staff
                </th>
                <th scope="col" className="pb-3">
                  <span className="sr-only">Save</span>
                </th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {(Object.keys(categoryLabels) as Category[]).map((category) => (
                <VisibilityRow
                  key={`${category}-${JSON.stringify(data.visibility![category])}`}
                  category={category}
                  value={data.visibility![category]}
                  roles={data.roles}
                  save={save}
                />
              ))}
            </tbody>
          </table>
        </div>
        <Notice className="mt-5">
          Historical statistics are retained permanently. Disconnecting stops
          collection.
        </Notice>
      </Card>
    </div>
  );
}

export function ClubVisibility() {
  const data = useClubWorkspace();
  const mutation = useMutation(api.clubStaff.setCategoryVisibility);
  return (
    <ClubVisibilityView
      data={data}
      save={(value) =>
        mutation({ communitySlug: data.community.slug, ...value })
      }
    />
  );
}
