# Test fixtures

Own test material, made for these tests (no third-party content):

- `colors.webm` – 2 s, 64 × 48 px, 8 fps: one second red, one second blue, with a 440 Hz tone
  (VP9 + Opus). Made with ffmpeg from its built-in test sources:

  ```sh
  ffmpeg -f lavfi -i "color=c=red:s=64x48:r=8:d=1" -f lavfi -i "color=c=blue:s=64x48:r=8:d=1" \
    -f lavfi -i "sine=frequency=440:duration=2:sample_rate=48000" \
    -filter_complex "[0:v][1:v]concat=n=2:v=1:a=0[v]" -map "[v]" -map 2:a \
    -c:v libvpx-vp9 -b:v 40k -pix_fmt yuv420p -c:a libopus -b:a 24k colors.webm
  ```
