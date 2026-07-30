import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";

import { ActionCard, ActionCardLabel, ActionCardLink, ActionCardMeta } from "./action-card";
import { Badge } from "./badge";
import { Button, buttonVariants } from "./button";
import { Card, Eyebrow, SectionDescription, SectionHeading, SectionTitle } from "./card";
import { EntityCard } from "./entity-card";
import { EventSchedule, EventScheduleRow } from "./event-schedule";
import { Field, FieldText, Input, Select, Textarea } from "./field";
import { MetadataItem, MetadataList } from "./metadata-list";
import { Notice } from "./notice";
import { BrandLink, PageContainer, PageNav, PageShell } from "./page-shell";
import { Table, TableCell, TableFrame, TableHead, TableHeaderCell } from "./table";
import { cn } from "@/lib/cn";

const meta = {
  title: "Design System/Primitives",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

function StoryFrame({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "dark" }) {
  return (
    <div
      className={cn(
        "min-h-screen px-6 py-8 sm:px-10",
        tone === "dark"
          ? "bg-[linear-gradient(135deg,var(--background),var(--surface-raised))] text-white"
          : "bg-background text-foreground",
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6">{children}</div>
    </div>
  );
}

const tokenSwatches = [
  { className: "bg-background", label: "Background" },
  { className: "bg-canvas", label: "Canvas" },
  { className: "bg-surface", label: "Surface" },
  { className: "bg-surface-strong", label: "Surface strong" },
  { className: "bg-surface-elevated", label: "Surface elevated" },
  { className: "bg-accent", label: "Accent" },
  { className: "bg-success", label: "Success" },
  { className: "bg-warning", label: "Warning" },
  { className: "bg-danger", label: "Danger" },
];

export const TokenSystem: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading description="Semantic roles are the contract. Palette values can change under them.">
        Token System
      </SectionHeading>
      <Card className="grid gap-4" surface="white">
        <div className="grid gap-3 border-b border-border pb-4">
          <p className="text-display">Display</p>
          <p className="text-title">Title</p>
          <p className="text-section">Section</p>
          <p className="text-body text-muted">Body and supporting text use named roles.</p>
          <p className="font-mono text-metadata text-subtle">Metadata / 9:00 PM</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {tokenSwatches.map((swatch) => (
            <div className="overflow-hidden rounded-card border border-border bg-surface" key={swatch.label}>
              <div className={cn("h-20", swatch.className)} />
              <div className="px-3 py-2 font-mono text-xs text-muted">{swatch.label}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Notice variant="info">Neutral information</Notice>
          <Notice variant="success">Successful state</Notice>
          <Notice variant="warning">Needs attention</Notice>
        </div>
      </Card>
    </StoryFrame>
  ),
};

export const Buttons: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading eyebrow="Buttons" description="Shared button variants for links, form actions, and dark hero CTAs.">
        Action Variants
      </SectionHeading>
      <Card className="grid gap-5" surface="white">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="surface">Surface</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="dangerGhost">Danger ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button disabled variant="primary">Disabled</Button>
        </div>
        <div className="rounded-panel bg-canvas p-5">
          <div className="flex flex-wrap gap-3">
            <Button variant="inversePrimary">Inverse primary</Button>
            <Button variant="inverse">Inverse</Button>
            <a className={buttonVariants({ size: "lg", variant: "inverse" })} href="#">
              Link action
            </a>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Small</Button>
          <Button size="md">Medium</Button>
          <Button size="lg">Large</Button>
        </div>
      </Card>
    </StoryFrame>
  ),
};

export const Badges: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading eyebrow="Badges" description="Compact trust, taxonomy, and status labels.">
        Badge Variants
      </SectionHeading>
      <Card className="flex flex-wrap gap-3" surface="white">
        <Badge>Default</Badge>
        <Badge variant="muted">Muted</Badge>
        <Badge variant="accent">Accent</Badge>
        <Badge variant="cyan">Cyan</Badge>
        <Badge mono>Mono label</Badge>
        <Badge shape="pill">Pill only when intentional</Badge>
      </Card>
      <div className="rounded-panel bg-canvas p-5">
        <div className="flex flex-wrap gap-3">
          <Badge variant="inverse">Inverse</Badge>
          <Badge mono variant="inverseMuted">Inverse muted</Badge>
          <Badge className="bg-cyan-300/18 text-cyan-50" variant="inverseMuted">
            World count
          </Badge>
        </div>
      </div>
    </StoryFrame>
  ),
};

export const CardsAndNotices: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading eyebrow="Cards" description="Panels should use named surfaces instead of one-off borders and radii.">
        Cards And Notices
      </SectionHeading>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <Eyebrow>Default</Eyebrow>
          <SectionTitle className="mt-3 text-2xl">Public profile routes</SectionTitle>
          <SectionDescription className="mt-2">Warm surface, subtle border, reusable spacing.</SectionDescription>
        </Card>
        <Card surface="strong">
          <Eyebrow>Strong</Eyebrow>
          <SectionTitle className="mt-3 text-2xl">Deployment facts</SectionTitle>
          <SectionDescription className="mt-2">Used when a panel needs more contrast.</SectionDescription>
        </Card>
        <Card surface="dashed">
          <Eyebrow>Dashed</Eyebrow>
          <SectionTitle className="mt-3 text-2xl">Empty state</SectionTitle>
          <SectionDescription className="mt-2">Useful for setup, missing data, and placeholders.</SectionDescription>
        </Card>
      </div>
      <div className="rounded-panel bg-canvas p-5">
        <Card surface="dark">
          <Eyebrow tone="inverse">Dark card</Eyebrow>
          <SectionTitle className="mt-3 text-2xl text-white">Tonight and soon</SectionTitle>
          <p className="mt-2 text-sm leading-6 text-white/76">Hero-adjacent content keeps text explicitly inverse.</p>
        </Card>
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Notice variant="info">Info notice for neutral guidance.</Notice>
        <Notice variant="success">Success notice for completed setup.</Notice>
        <Notice variant="error">Error notice for blocked actions.</Notice>
      </div>
    </StoryFrame>
  ),
};

export const FormsAndTables: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading eyebrow="Forms" description="Fields and tables share the same control radius and border tone.">
        Forms And Tables
      </SectionHeading>
      <Card className="grid gap-5 lg:grid-cols-2" surface="white">
        <div className="grid gap-4">
          <Field>
            Display name
            <Input placeholder="DJ Aurora" />
            <FieldText>Use the public name visitors should recognize.</FieldText>
          </Field>
          <Field>
            Profile type
            <Select defaultValue="person">
              <option value="person">Person</option>
              <option value="community">Community</option>
            </Select>
          </Field>
          <Field>
            Summary
            <Textarea placeholder="A concise community-submitted summary." rows={4} />
          </Field>
        </div>
        <TableFrame>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Slot</TableHeaderCell>
                <TableHeaderCell>Performer</TableHeaderCell>
                <TableHeaderCell>Genre</TableHeaderCell>
              </tr>
            </TableHead>
            <tbody>
              <tr>
                <TableCell>10:00 PM</TableCell>
                <TableCell>DJ Aurora</TableCell>
                <TableCell>House</TableCell>
              </tr>
              <tr>
                <TableCell>10:45 PM</TableCell>
                <TableCell>DJ Lumen</TableCell>
                <TableCell>Trance</TableCell>
              </tr>
            </tbody>
          </Table>
        </TableFrame>
      </Card>
    </StoryFrame>
  ),
};

export const EventSchedulePrimitive: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading description="Rows prioritize when something happens, then what it is, who hosts it, and where it is.">
        Event Schedule
      </SectionHeading>
      <Card className="grid gap-5" surface="white">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionTitle className="text-title">Tonight</SectionTitle>
            <SectionDescription className="mt-2">A compact schedule primitive for Home and event surfaces.</SectionDescription>
          </div>
          <Button size="sm" variant="surface">Open full schedule</Button>
        </div>
        <EventSchedule>
          <EventScheduleRow
            details="Afterglow / Neon Harbor"
            href="#"
            metadata={
              <MetadataList density="compact">
                <MetadataItem>Doors</MetadataItem>
                <MetadataItem>Friends+</MetadataItem>
              </MetadataList>
            }
            status="now"
            statusLabel="Now"
            summary="Open room and host handoff before the first set."
            time="8:00 PM"
            title="Doors open"
          />
          <EventScheduleRow
            details="Afterglow / Neon Harbor / DJ Aurora"
            href="#"
            metadata={
              <MetadataList density="compact">
                <MetadataItem>House</MetadataItem>
                <MetadataItem>Live</MetadataItem>
              </MetadataList>
            }
            status="soon"
            statusLabel="Soon"
            time="9:00 PM"
            title="Harbor Sessions"
          />
          <EventScheduleRow
            details="Afterglow / Neon Harbor / DJ Lumen"
            metadata={
              <MetadataList density="compact">
                <MetadataItem>Trance</MetadataItem>
                <MetadataItem>VJ Lumen</MetadataItem>
              </MetadataList>
            }
            time="10:00 PM"
            title="Late Signal"
          />
        </EventSchedule>
      </Card>
    </StoryFrame>
  ),
};

export const EventScheduleEmptyState: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading description="The schedule stays quiet when no rows are available.">
        Empty Schedule
      </SectionHeading>
      <Card surface="white">
        <EventSchedule empty="No events scheduled.">{false}</EventSchedule>
      </Card>
    </StoryFrame>
  ),
};

export const EntitiesAndMetadata: Story = {
  render: () => (
    <StoryFrame>
      <SectionHeading description="Entity identity stays route-owned while structure remains consistent.">
        Entities And Metadata
      </SectionHeading>
      <div className="grid gap-4 lg:grid-cols-2">
        <EntityCard
          description="House and garage sets across VRChat events."
          href="#"
          media={
            <div className="flex size-16 items-center justify-center rounded-card bg-surface-raised font-mono text-entity">
              DA
            </div>
          }
          metadata={
            <MetadataList>
              <MetadataItem>Person</MetadataItem>
              <MetadataItem>Indianapolis</MetadataItem>
            </MetadataList>
          }
          title="DJ Aurora"
        />
        <EntityCard
          actions={<Button size="sm" variant="surface">View events</Button>}
          description="Late-night events hosted in Neon Harbor."
          href="#"
          metadata={
            <MetadataList tone="subtle">
              <MetadataItem>Community</MetadataItem>
              <MetadataItem>3 upcoming events</MetadataItem>
            </MetadataList>
          }
          title="Afterglow"
        />
      </div>
    </StoryFrame>
  ),
};

export const ShellAndActions: Story = {
  render: () => (
    <PageShell>
      <PageContainer max="5xl">
        <PageNav accountMode="signed-out">
          <BrandLink />
          <a className={buttonVariants({ variant: "secondary" })} href="#">
            Secondary action
          </a>
        </PageNav>
        <Card padding="lg" surface="white">
          <Eyebrow>Page shell</Eyebrow>
          <SectionTitle className="mt-4">Reusable Shell And Action Cards</SectionTitle>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">
            Page-level spacing and action cards should remain consistent across account, submit, event, and profile surfaces.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <ActionCard variant="accent">
              <ActionCardLabel>Afterglow event listing</ActionCardLabel>
              <ActionCardMeta>Source</ActionCardMeta>
            </ActionCard>
            <ActionCard variant="surface">
              <ActionCardLabel>Afterglow watch link</ActionCardLabel>
              <ActionCardMeta>Watch / Open</ActionCardMeta>
            </ActionCard>
            <ActionCardLink href="#" variant="surface">
              <ActionCardLabel>Profile proof</ActionCardLabel>
              <ActionCardMeta>Claim / Verify</ActionCardMeta>
            </ActionCardLink>
          </div>
        </Card>
      </PageContainer>
    </PageShell>
  ),
};
