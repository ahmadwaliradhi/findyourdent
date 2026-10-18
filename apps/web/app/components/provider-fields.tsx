// The Provider part of the Testimony form (spec 03, ADR-0005): the Autocomplete
// picker, then the typed name and Region (not yet Listed) or the stored name and
// Region read-only with "Sarankan koreksi" (Listed). Google's words appear only in
// the live suggestion list: the value, which goes into the browser draft, keeps the
// placeId and what the Patient typed, never Google's name.
import type { RegionRef } from "@findyourdent/contracts/firestore";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RegionFields } from "~/components/region-fields";
import { Button } from "~/components/ui/button";
import { FieldError as ErrorLine, fieldClassName } from "~/components/ui/field";
import { APP_CHECK_HEADER } from "~/lib/app-check";
import { getAppCheckToken, signInWithGoogle } from "~/lib/firebase.client";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { regionLabel } from "~/lib/regions";
import {
  AUTOCOMPLETE_DEBOUNCE_MS,
  AUTOCOMPLETE_MIN_CHARS,
  type AutocompleteResponse,
  type NameCorrectionRequest,
  type ProviderFieldsValue,
  type ProviderListingResponse,
  TESTIMONY_LIMITS,
} from "~/lib/testimony";
import { cn } from "~/lib/utils";

export interface ProviderFieldsProps {
  value: ProviderFieldsValue;
  onChange(value: ProviderFieldsValue): void;
  /** Field name to message, from the server's fieldErrors (placeId, providerName, region.provinceCode, region.regencyCode). */
  errors?: Record<string, string>;
  disabled?: boolean;
}

type Suggestion = AutocompleteResponse["suggestions"][number];
type RegionValue = ProviderFieldsValue["region"];

/** One Autocomplete session per pick; crypto.randomUUID needs a secure context, so a fallback. */
function newSessionToken(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function FieldError(props: { id: string; message?: string }) {
  if (!props.message) return null;
  return <ErrorLine id={props.id}>{props.message}</ErrorLine>;
}

/**
 * Provider picker (Places Autocomplete through /api/places/autocomplete), then either
 * the typed-name field and Region selects (not Listed) or the stored name and Region
 * read-only with "Sarankan koreksi" (Listed).
 */
export function ProviderFields({ value, onChange, errors = {}, disabled }: ProviderFieldsProps) {
  const { t } = useTranslation();
  const id = useId();
  // The latest value, for the listing answer that arrives after the Patient typed on.
  const latest = useRef(value);
  latest.current = value;
  const emit = useRef(onChange);
  emit.current = onChange;
  const [listing, setListing] = useState<"checking" | "checked" | "failed">("checked");

  // Whether the picked place is Listed: asked on every pick and again for a restored
  // draft, since the place may have become Listed since. A free Firestore read.
  const placeId = value.placeId;
  useEffect(() => {
    if (!placeId) return;
    const controller = new AbortController();
    setListing("checking");
    fetch(`/api/providers/${encodeURIComponent(placeId)}/listing`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`listing ${response.status}`);
        const body = (await response.json()) as ProviderListingResponse;
        if (latest.current.placeId !== placeId) return;
        emit.current({
          ...latest.current,
          listed: body.listed ? { name: body.name, region: body.region } : null,
        });
        setListing("checked");
      })
      .catch(() => {
        if (!controller.signal.aborted) setListing("failed");
      });
    return () => controller.abort();
  }, [placeId]);

  if (!placeId) {
    return (
      <PlacePicker
        error={errors.placeId}
        disabled={disabled}
        onPick={(picked) => onChange({ ...latest.current, placeId: picked, listed: null, providerName: "" })}
      />
    );
  }

  const change = () => onChange({ ...latest.current, placeId: null, listed: null, providerName: "" });

  return (
    <fieldset className="flex flex-col gap-4" disabled={disabled}>
      <legend className="sr-only">{t("providerFields.pickerLabel")}</legend>
      <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">{t("providerFields.picked")}</span>
        <Button type="button" variant="link" size="sm" className="px-0" onClick={change}>
          {t("providerFields.change")}
        </Button>
      </div>
      <FieldError id={`${id}-place-error`} message={errors.placeId} />

      {listing === "checking" ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t("providerFields.checkingListing")}
        </p>
      ) : listing === "failed" ? (
        <ErrorLine role="alert">{t("providerFields.listingFailed")}</ErrorLine>
      ) : value.listed ? (
        <ListedProvider placeId={placeId} listed={value.listed} />
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">
              {t("providerFields.nameLabel")}
            </label>
            <input
              id={`${id}-name`}
              type="text"
              required
              autoComplete="off"
              maxLength={TESTIMONY_LIMITS.providerNameMaxChars}
              value={value.providerName}
              onChange={(event) => onChange({ ...latest.current, providerName: event.currentTarget.value })}
              aria-invalid={errors.providerName ? true : undefined}
              aria-describedby={`${id}-name-hint${errors.providerName ? ` ${id}-name-error` : ""}`}
              className={fieldClassName}
            />
            <p id={`${id}-name-hint`} className="text-sm text-muted-foreground">
              {t("providerFields.nameHint")}
            </p>
            <FieldError id={`${id}-name-error`} message={errors.providerName} />
          </div>
          <RegionFields
            mode="pick"
            value={value.region}
            onChange={(region) => onChange({ ...latest.current, region })}
            errors={{
              province: errors["region.provinceCode"],
              regency: errors["region.regencyCode"],
              district: errors["region.districtCode"],
            }}
            required
            withDistrict
          />
        </>
      )}
    </fieldset>
  );
}

/** Combobox over /api/places/autocomplete: a 300 ms pause and 3 characters before any request. */
function PlacePicker(props: { onPick(placeId: string): void; error?: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig();
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "unavailable" | "failed">("idle");
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState<{ lat: number; lng: number } | "asking" | "denied" | null>(null);
  const sessionToken = useRef<string | null>(null);

  const query = text.trim();
  const coords = typeof location === "object" ? location : null;
  useEffect(() => {
    if (query.length < AUTOCOMPLETE_MIN_CHARS) {
      setSuggestions([]);
      setStatus("idle");
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      sessionToken.current ??= newSessionToken();
      const params = new URLSearchParams({ input: query, sessionToken: sessionToken.current });
      if (coords) {
        params.set("lat", String(coords.lat));
        params.set("lng", String(coords.lng));
      }
      try {
        const token = await getAppCheckToken(firebase).catch(() => "");
        const response = await fetch(`/api/places/autocomplete?${params}`, {
          headers: { [APP_CHECK_HEADER]: token },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`autocomplete ${response.status}`);
        const body = (await response.json()) as AutocompleteResponse;
        setSuggestions(body.suggestions);
        setStatus(body.unavailable ? "unavailable" : "done");
        setActive(-1);
        setOpen(true);
      } catch {
        if (!controller.signal.aborted) {
          setSuggestions([]);
          setStatus("failed");
        }
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, coords, firebase]);

  function pick(suggestion: Suggestion) {
    // Google's name is not kept: the input clears and only the placeId goes up.
    sessionToken.current = null;
    setText("");
    setSuggestions([]);
    setOpen(false);
    props.onPick(suggestion.placeId);
  }

  // Only when the Patient taps: never asked for automatically.
  function shareLocation() {
    if (!("geolocation" in navigator)) {
      setLocation("denied");
      return;
    }
    setLocation("asking");
    navigator.geolocation.getCurrentPosition(
      (position) => setLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => setLocation("denied"),
      { maximumAge: 10 * 60 * 1000, timeout: 15_000 },
    );
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === "Enter" && open && active >= 0) {
      event.preventDefault();
      const suggestion = suggestions[active];
      if (suggestion) pick(suggestion);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const expanded = open && suggestions.length > 0;
  const message =
    status === "loading"
      ? t("providerFields.searching")
      : status === "unavailable"
        ? t("providerFields.unavailable")
        : status === "failed"
          ? t("providerFields.searchFailed")
          : status === "done" && suggestions.length === 0
            ? t("providerFields.noSuggestions")
            : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-sm font-medium">
        {t("providerFields.pickerLabel")}
      </label>
      <div className="relative">
        <input
          id={`${id}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined}
          aria-invalid={props.error ? true : undefined}
          aria-describedby={`${id}-hint${props.error ? ` ${id}-error` : ""}`}
          placeholder={t("providerFields.pickerPlaceholder")}
          disabled={props.disabled}
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className={fieldClassName}
        />
        <div
          id={listboxId}
          role="listbox"
          aria-label={t("providerFields.suggestionsLabel")}
          hidden={!expanded}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-md border bg-background text-foreground shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={suggestion.placeId}
              id={`${id}-option-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              // mousedown, not click: the input keeps focus and its blur does not close the list first.
              onMouseDown={(event) => {
                event.preventDefault();
                pick(suggestion);
              }}
              onMouseEnter={() => setActive(index)}
              className={cn(
                "flex min-h-11 cursor-pointer flex-col justify-center px-3 py-2",
                index === active && "bg-accent text-accent-foreground",
              )}
            >
              <span className="text-sm font-medium">{suggestion.mainText}</span>
              {suggestion.secondaryText ? (
                <span className="text-xs text-muted-foreground">{suggestion.secondaryText}</span>
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {t("providerFields.pickerHint")}
      </p>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {message}
      </p>
      <FieldError id={`${id}-error`} message={props.error} />
      <div>
        {coords ? (
          <p className="text-sm text-muted-foreground">{t("providerFields.usingLocation")}</p>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={shareLocation}
            disabled={props.disabled || location === "asking"}
          >
            {t("providerFields.useLocation")}
          </Button>
        )}
        {location === "denied" ? (
          <p className="mt-1 text-sm text-muted-foreground">{t("providerFields.locationDenied")}</p>
        ) : null}
      </div>
    </div>
  );
}

/** The stored name and Region, read-only, with "Sarankan koreksi". */
function ListedProvider(props: { placeId: string; listed: { name: string; region: RegionRef } }) {
  const { t } = useTranslation();
  const [correcting, setCorrecting] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-md border px-3 py-3">
      <p className="text-sm text-muted-foreground">{t("providerFields.listedNote")}</p>
      <dl className="grid gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("providerFields.storedName")}</dt>
          <dd className="font-medium">{props.listed.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("providerFields.storedRegion")}</dt>
          <dd className="font-medium">{regionLabel(props.listed.region)}</dd>
        </div>
      </dl>
      {correcting ? (
        <CorrectionForm placeId={props.placeId} onClose={() => setCorrecting(false)} />
      ) : (
        <div>
          <Button type="button" variant="link" size="sm" className="px-0" onClick={() => setCorrecting(true)}>
            {t("providerFields.correction.open")}
          </Button>
        </div>
      )}
    </div>
  );
}

type CorrectionState =
  | { kind: "editing" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; code: string; message?: string };

/**
 * "Sarankan koreksi": a name and/or Region for the admin to check. Not a nested
 * <form>, since it sits inside the Testimony form; the button posts it with fetch.
 */
function CorrectionForm(props: { placeId: string; onClose(): void }) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig();
  const id = useId();
  const [name, setName] = useState("");
  const [region, setRegion] = useState<RegionValue>({ provinceCode: "", regencyCode: "" });
  const [state, setState] = useState<CorrectionState>({ kind: "editing" });

  async function send() {
    const request: NameCorrectionRequest = {};
    if (name.trim()) request.suggestedName = name.trim();
    if (region.provinceCode && region.regencyCode) request.suggestedRegion = region;
    if (!request.suggestedName && !request.suggestedRegion) {
      setState({ kind: "error", code: "invalid_submission" });
      return;
    }
    setState({ kind: "sending" });
    try {
      const token = await getAppCheckToken(firebase).catch(() => "");
      const response = await fetch(`/api/providers/${encodeURIComponent(props.placeId)}/name-corrections`, {
        method: "POST",
        headers: { "content-type": "application/json", [APP_CHECK_HEADER]: token },
        body: JSON.stringify(request),
      });
      if (response.status === 201) {
        setState({ kind: "sent" });
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      setState({ kind: "error", code: body.error ?? "generic", message: body.message });
    } catch {
      setState({ kind: "error", code: "generic" });
    }
  }

  async function signInThenSend() {
    if (!firebase.app) return;
    setState({ kind: "sending" });
    try {
      await signInWithGoogle(firebase.app);
    } catch {
      setState({ kind: "error", code: "sign_in_required" });
      return;
    }
    await send();
  }

  if (state.kind === "sent") {
    return (
      <p className="text-sm" role="status">
        {t("providerFields.correction.sent")}
      </p>
    );
  }

  const errorMessage =
    state.kind === "error"
      ? (state.message ??
        t(`providerFields.correction.errors.${state.code}`, {
          defaultValue: t("providerFields.correction.errors.generic"),
        }))
      : null;
  const sending = state.kind === "sending";

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3 border-t pt-3">
      <h3 id={`${id}-title`} className="text-sm font-semibold">
        {t("providerFields.correction.title")}
      </h3>
      <p className="text-sm text-muted-foreground">{t("providerFields.correction.intro")}</p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${id}-name`} className="text-sm font-medium">
          {t("providerFields.correction.nameLabel")}
        </label>
        <input
          id={`${id}-name`}
          type="text"
          autoComplete="off"
          maxLength={TESTIMONY_LIMITS.correctionNameMaxChars}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          className={fieldClassName}
        />
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">{t("providerFields.correction.regionLabel")}</legend>
        <RegionFields mode="pick" value={region} onChange={setRegion} />
      </fieldset>
      {errorMessage ? <ErrorLine role="alert">{errorMessage}</ErrorLine> : null}
      <div className="flex flex-wrap gap-2">
        {state.kind === "error" && state.code === "sign_in_required" && firebase.app ? (
          <Button type="button" onClick={signInThenSend} disabled={sending}>
            {t("providerFields.correction.signIn")}
          </Button>
        ) : (
          <Button type="button" onClick={send} disabled={sending}>
            {sending ? t("providerFields.correction.sending") : t("providerFields.correction.submit")}
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={props.onClose} disabled={sending}>
          {t("providerFields.correction.cancel")}
        </Button>
      </div>
    </section>
  );
}
