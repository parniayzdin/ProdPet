
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64

Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

enum Emotion {
  IDLE,        // 0
  SEARCHING,   // 1
  HAPPY,       // 2
  CURIOUS,     // 3
  THINKING,    // 4
  FOCUSED,     // 5
  DISTRACTED,  // 6
  CELEBRATING, // 7
  SLEEPY,      // 8
  ANGRY        // 9
};

Emotion currentEmotion = IDLE;

// true = automatically cycle through emotions
// false = control emotions through Serial Monitor (demo)
bool demoMode = false;

unsigned long lastFrame = 0;
unsigned long lastEmotionChange = 0;
unsigned long emotionStart = 0;

int emotionIndex = 0;

Emotion emotions[] = {
  IDLE,
  SEARCHING,
  HAPPY,
  CURIOUS,
  THINKING,
  FOCUSED,
  DISTRACTED,
  CELEBRATING,
  SLEEPY,
  ANGRY
};

const int emotionCount = sizeof(emotions) / sizeof(emotions[0]);

void changeEmotion(Emotion newEmotion) {
  if (currentEmotion != newEmotion) {
    currentEmotion = newEmotion;
    emotionStart = millis();
  }
}

// Basic eye shapes

void drawEye(int x, int y, int width, int height) {
  display.fillRoundRect(
    x - width / 2,
    y - height / 2,
    width,
    height,
    min(width, height) / 2,
    SSD1306_WHITE
  );
}

void drawClosedEye(int x, int y) {
  display.drawFastHLine(x - 14, y, 28, SSD1306_WHITE);
  display.drawFastHLine(x - 14, y + 1, 28, SSD1306_WHITE);
}

void drawHappyEye(int x, int y) {
  for (int i = 0; i < 4; i++) {
    display.drawLine(x - 15, y + 7 + i,
                     x, y - 8 + i, SSD1306_WHITE);

    display.drawLine(x, y - 8 + i,
                     x + 15, y + 7 + i, SSD1306_WHITE);
  }
}

// Idle - blinks every few seconds

void drawIdleEyes(unsigned long t) {
  if (t % 3500 < 150) {
    drawClosedEye(39, 32);
    drawClosedEye(89, 32);
  } else {
    drawEye(39, 32, 27, 36);
    drawEye(89, 32, 27, 36);
  }
}

// Searching - pupils move from side to side

void drawSearchingEyes(unsigned long t) {
  int step = (t / 300) % 8;
  int offset;

  if (step < 4) {
    offset = step * 3 - 5;
  } else {
    offset = (7 - step) * 3 - 5;
  }

  drawEye(39, 32, 32, 34);
  drawEye(89, 32, 32, 34);

  display.fillCircle(39 + offset, 32, 6, SSD1306_BLACK);
  display.fillCircle(89 + offset, 32, 6, SSD1306_BLACK);
}

// Happy - smiling eyes bounce slightly

void drawHappyEyes(unsigned long t) {
  int bounce = (t / 250) % 2;

  drawHappyEye(39, 32 - bounce * 2);
  drawHappyEye(89, 32 - bounce * 2);
}

// Curious - one eye is larger

void drawCuriousEyes(unsigned long t) {
  int shift = (t / 600) % 2;

  drawEye(39, 32 + shift * 3, 23, 30);
  drawEye(89, 32, 32, 42);

  display.fillCircle(43, 32 + shift * 3, 5, SSD1306_BLACK);
  display.fillCircle(93, 32, 6, SSD1306_BLACK);
}

// Thinking - dots appear above the eyes

void drawThinkingEyes(unsigned long t) {
  drawEye(39, 40, 27, 18);
  drawEye(89, 40, 27, 18);

  int dots = (t / 400) % 4;

  for (int i = 0; i < dots; i++) {
    display.fillCircle(52 + i * 12, 12,
                       2 + i, SSD1306_WHITE);
  }
}

// Focused - determined-looking eyes

void drawFocusedEyes(unsigned long t) {
  drawEye(39, 35, 30, 31);
  drawEye(89, 35, 30, 31);

  display.fillTriangle(19, 15, 56, 15, 56, 25,
                       SSD1306_BLACK);

  display.fillTriangle(72, 15, 109, 15, 72, 25,
                       SSD1306_BLACK);
}

// Distracted - eyes shake

void drawDistractedEyes(unsigned long t) {
  int shake = (t / 120) % 2 == 0 ? -2 : 2;

  display.drawLine(22 + shake, 23,
                   54 + shake, 32, SSD1306_WHITE);
  display.drawLine(22 + shake, 43,
                   54 + shake, 32, SSD1306_WHITE);

  display.drawLine(106 + shake, 23,
                   74 + shake, 32, SSD1306_WHITE);
  display.drawLine(106 + shake, 43,
                   74 + shake, 32, SSD1306_WHITE);
}

// Celebrating - happy eyes with sparkles

void drawCelebratingEyes(unsigned long t) {
  int bounce = (t / 180) % 2 == 0 ? 0 : 3;

  drawHappyEye(39, 33 - bounce);
  drawHappyEye(89, 33 - bounce);

  if ((t / 300) % 2 == 0) {
    display.drawLine(10, 12, 20, 12, SSD1306_WHITE);
    display.drawLine(15, 7, 15, 17, SSD1306_WHITE);

    display.drawLine(108, 12, 118, 12, SSD1306_WHITE);
    display.drawLine(113, 7, 113, 17, SSD1306_WHITE);
  }
}

// Sleepy - mostly closed eyes

void drawSleepyEyes(unsigned long t) {
  if ((t / 1000) % 4 == 0) {
    drawEye(39, 36, 29, 12);
    drawEye(89, 36, 29, 12);
  } else {
    drawClosedEye(39, 37);
    drawClosedEye(89, 37);
  }
}

// Angry - slanted eyes with a slight shake

void drawAngryEyes(unsigned long t) {
  int shake = (t / 150) % 2 == 0 ? -1 : 1;

  drawEye(39 + shake, 35, 30, 30);
  drawEye(89 + shake, 35, 30, 30);

  display.fillTriangle(
    20 + shake, 15,
    55 + shake, 15,
    55 + shake, 34,
    SSD1306_BLACK
  );

  display.fillTriangle(
    73 + shake, 15,
    108 + shake, 15,
    73 + shake, 34,
    SSD1306_BLACK
  );

  display.drawLine(23 + shake, 20,
                   53 + shake, 32, SSD1306_WHITE);

  display.drawLine(75 + shake, 32,
                   105 + shake, 20, SSD1306_WHITE);
}

// Draw whichever emotion is currently active

void updateEyes() {
  unsigned long t = millis() - emotionStart;

  display.clearDisplay();

  switch (currentEmotion) {
    case IDLE:
      drawIdleEyes(t);
      break;

    case SEARCHING:
      drawSearchingEyes(t);
      break;

    case HAPPY:
      drawHappyEyes(t);
      break;

    case CURIOUS:
      drawCuriousEyes(t);
      break;

    case THINKING:
      drawThinkingEyes(t);
      break;

    case FOCUSED:
      drawFocusedEyes(t);
      break;

    case DISTRACTED:
      drawDistractedEyes(t);
      break;

    case CELEBRATING:
      drawCelebratingEyes(t);
      break;

    case SLEEPY:
      drawSleepyEyes(t);
      break;

    case ANGRY:
      drawAngryEyes(t);
      break;
  }

  display.display();
}

// Read emotion numbers from Serial Monitor

void checkSerial() {
  while (Serial.available() > 0) {
    char input = Serial.read();

    if (input >= '0' && input <= '9') {
      int number = input - '0';
      changeEmotion(emotions[number]);

      Serial.print("Emotion changed to: ");
      Serial.println(number);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(21, 22);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED not found");
    while (true) {
    }
  }

  display.clearDisplay();
  display.display();

  emotionStart = millis();

  Serial.println("Robot eyes ready!");
}

void loop() {
  unsigned long now = millis();

  // Check for manual commands
  checkSerial();

  // switch emotions every 4 seconds in demo mode
  if (demoMode && now - lastEmotionChange >= 4000) {
    lastEmotionChange = now;
    emotionIndex = (emotionIndex + 1) % emotionCount;
    changeEmotion(emotions[emotionIndex]);
  }

  // update the OLED animation
  if (now - lastFrame >= 66) {
    lastFrame = now;
    updateEyes();
  }
}
