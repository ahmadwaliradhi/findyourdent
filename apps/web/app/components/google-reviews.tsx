import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { useFirebaseConfig } from "~/lib/firebase-config";
import { fetchGoogleRoute } from "~/lib/google-routes";
import type { GoogleReviewsResponse, PublicGoogleReview } from "~/lib/provider";

type State =
  | { phase: "closed" }
  | { phase: "loading" }
  | { phase: "done"; result: GoogleReviewsResponse }
  | { phase: "error" };

/**
 * "Lihat ulasan Google" (spec 02): the reviews-only Place Details call happens only
 * on this tap. Used on Shortlist cards and the Provider page.
 */
export function GoogleReviews({ placeId }: { placeId: string }) {
  const { t } = useTranslation();
  const firebase = useFirebaseConfig();
  const [state, setState] = useState<State>({ phase: "closed" });

  const open = async () => {
    setState({ phase: "loading" });
    try {
      setState({ phase: "done", result: await fetchGoogleRoute(firebase, placeId, "reviews") });
    } catch {
      setState({ phase: "error" });
    }
  };

  if (state.phase === "closed") {
    return (
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => void open()}>
        {t("provider.reviews.open")}
      </Button>
    );
  }
  return (
    <section className="flex flex-col gap-2" aria-busy={state.phase === "loading"} data-testid="google-reviews">
      <h4 className="text-sm font-semibold">{t("provider.reviews.title")}</h4>
      <div aria-live="polite" className="flex flex-col gap-3">
        {state.phase === "loading" && <p className="text-sm text-muted-foreground">{t("provider.reviews.loading")}</p>}
        {(state.phase === "error" || (state.phase === "done" && !state.result.available)) && (
          <p className="text-sm text-muted-foreground">{t("provider.reviews.unavailable")}</p>
        )}
        {state.phase === "done" && state.result.available && state.result.reviews.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("provider.reviews.empty")}</p>
        )}
        {state.phase === "done" && state.result.available && state.result.reviews.length > 0 && (
          <ul className="flex flex-col gap-3">
            {state.result.reviews.map((review, index) => (
              // Google gives no stable id in this field mask; the list never reorders.
              // biome-ignore lint/suspicious/noArrayIndexKey: static list from one response
              <GoogleReviewItem key={index} review={review} />
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("provider.attribution")}</p>
    </section>
  );
}

function GoogleReviewItem({ review }: { review: PublicGoogleReview }) {
  const { t } = useTranslation();
  const { author } = review;
  const name = author.uri ? (
    <a href={author.uri} target="_blank" rel="noreferrer" className="font-medium underline-offset-2 hover:underline">
      {author.name}
    </a>
  ) : (
    <span className="font-medium">{author.name}</span>
  );
  return (
    <li className="flex gap-3 text-sm">
      {author.photoUri && (
        <img
          src={author.photoUri}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-8 shrink-0 rounded-full"
        />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p>
          {name}
          {review.relativeTime && <span className="text-muted-foreground"> · {review.relativeTime}</span>}
        </p>
        {review.rating !== undefined && (
          <p className="text-muted-foreground">{t("provider.reviews.rating", { rating: review.rating })}</p>
        )}
        {review.text && <p className="whitespace-pre-line break-words">{review.text}</p>}
      </div>
    </li>
  );
}
