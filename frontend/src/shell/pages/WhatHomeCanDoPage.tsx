import { useEffect, useState } from "react";
import type { CarouselApi } from "@maipai/ui/src/ui/carousel";
import { Button } from "@maipai/ui/src/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/ui/card";
import { Carousel, CarouselContent, CarouselItem } from "@maipai/ui/src/ui/carousel";
import { heroSlides } from "@/content/heroSlides";

export function WhatHomeCanDoPage() {
  const slides = heroSlides();
  const [carouselApi, setCarouselApi] = useState<CarouselApi | undefined>();
  const [paused, setPaused] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (query.matches) setPaused(true);
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <main>
      <h1>What Home can do</h1>
      <Carousel
        aria-label="What Home can do"
        autoplay
        autoplayDelay={8000}
        setApi={setCarouselApi}
        paused={paused}
        onPausedChange={setPaused}
        pauseOnFocus={false}
        pauseOnHover={false}
      >
        <CarouselContent>
          {slides.map((slide) => (
            <CarouselItem key={slide.id} aria-label={slide.heading}>
              <Card>
                <CardHeader>
                  <img src={`/brand/${slide.image}`} alt="" />
                  <CardTitle>{slide.heading}</CardTitle>
                </CardHeader>
                <CardContent><p>{slide.text}</p></CardContent>
              </Card>
            </CarouselItem>
          ))}
        </CarouselContent>
        <Button type="button" onClick={() => setPaused((value) => !value)}>
          {paused ? "Play slides" : "Pause slides"}
        </Button>
        <nav aria-label="Choose a slide">
          {slides.map((slide, index) => (
            <Button
              key={slide.id}
              type="button"
              variant="ghost"
              aria-label={`Slide ${index + 1} of ${slides.length}`}
              onClick={() => {
                carouselApi?.scrollTo(index);
              }}
            >
              {index + 1}
            </Button>
          ))}
        </nav>
      </Carousel>
    </main>
  );
}
