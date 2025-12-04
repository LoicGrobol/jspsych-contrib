import { JsPsych, JsPsychPlugin, ParameterType, TrialType } from "jspsych";

import { version } from "../package.json";

const info = <const>{
  name: "maze",
  version: version,
  parameters: {
    /** Array of [word, foil] couples */
    sentence: {
      type: ParameterType.COMPLEX,
      array: true,
    },
    canvas_size: {
      type: ParameterType.STRING,
      array: true,
      pretty_name: "Canvas size",
      default: ["100vw", "100vh"],
    },

    /** Whether to stop the trial on the first error.*/
    halt_on_error: {
      type: ParameterType.BOOL,
      pretty_name: "Halt on error",
      default: false,
    },
    /** The instruction to display at the beginning of the trial */
    instruction: {
      type: ParameterType.STRING,
      pretty_name: "Instruction",
      default: null,
    },
    /** How long to wait on a blank screen before displaying the next word. */
    inter_word_interval: {
      type: ParameterType.INT,
      pretty_name: "Inter-words interval",
      default: 0,
    },
    keys: {
      type: ParameterType.COMPLEX,
      pretty_name: "Validation keys",
      default: { left: "f", right: "j" },
      nested: {
        left: {
          type: ParameterType.STRING,
          pretty_name: "Left key",
        },
        right: {
          type: ParameterType.STRING,
          pretty_name: "Right key",
        },
      },
    },
    /** The minimum time (in ms) before the subject is allowed to chose a word. */
    pre_answer_interval: {
      type: ParameterType.INT,
      pretty_name: "Pre-answer Interval",
      default: 0,
    },
  },
  data: {
    sentence: {
      type: ParameterType.STRING,
    },
    events: {
      type: ParameterType.COMPLEX,
      array: true,
      nested: {
        correct: { type: ParameterType.BOOL },
        foil: { type: ParameterType.STRING },
        rt: { type: ParameterType.INT },
        side: { type: ParameterType.STRING },
        word: { type: ParameterType.STRING },
        word_number: { type: ParameterType.INT },
      },
    },
  },
  // prettier-ignore
  citations: '__CITATIONS__',
};

type Info = typeof info;

interface Response {
  correct: boolean;
  foil: string;
  rt: number;
  side: "left" | "right";
  word: string;
}

/**
 * **maze**
 *
 * A jsPsych plugin for running Maze experiments
 *
 * @author Morgan Grobol
 * @see {@link https://github.com/jspsych/jspsych-contrib/packages/plugin-maze/README.md}}
 */
class MazePlugin implements JsPsychPlugin<Info> {
  static info = info;
  display_element: HTMLElement;
  canvas_colour: string;
  center_clientX: number;
  center_display: HTMLElement;
  display_parent: HTMLElement;
  instruction: string;
  keys: { left: string; right: string };
  left_display: HTMLElement;
  right_display: HTMLElement;
  style: HTMLElement;
  text_display: HTMLElement;

  constructor(private jsPsych: JsPsych) {}

  trial(display_element: HTMLElement, trial: TrialType<Info>) {
    this.display_element = display_element;
    this.display_element.innerHTML = `
      <div id="jspsych-maze-display_parent">
        <div id="jspsych-maze-center_display" class="jspsych-maze-display"></div>
        <div id="jspsych-maze-text_display" class="jspsych-maze-display"></div>
        <div id="jspsych-maze-left_display" class="jspsych-maze-display jspsy-maze-answer"></div>
        <div id="jspsych-maze-right_display" class="jspsych-maze-display jspsy-maze-answer"></div>
      </div>`;
    this.style = document.createElement("style");
    this.style.innerHTML = `
		html, body { overscroll-behavior-y: contain; }
		#jspsych-maze-display_parent {
			position: relative;
			width: ${trial.canvas_size[0]};
			height: ${trial.canvas_size[1]};
		}
		.jspsych-maze-display{
			position: absolute;
		}
		.jspsych-maze-answer{
			width: max-content;
		}
		.highlighted {
			border: 2px solid red;
		}
		#jspsych-maze-center_display {
			top: 50%;
			transform: translateY(-50%);
			width: 100%;
		}
		#jspsych-maze-text_display {
			top: 50%;
			transform: translateY(-50%) translateY(-5em);
			width: 100%;
		}
		#jspsych-maze-left_display {
			left: calc(100% / 3);
			top: 50%;
			transform: translate(-50%, -50%);
		}
		#jspsych-maze-right_display {
			left: calc(2 * (100% / 3));
			top: 50%;
			transform: translate(-50%, -50%);
		}
      `;
    document.head.appendChild(this.style);
    this.display_parent = document.getElementById("jspsych-maze-display_parent");
    this.center_clientX = this.display_element.clientLeft + 0.5 * this.display_element.clientWidth;
    this.center_display = document.getElementById("jspsych-maze-center_display");
    this.left_display = document.getElementById("jspsych-maze-left_display");
    this.right_display = document.getElementById("jspsych-maze-right_display");
    this.text_display = document.getElementById("jspsych-maze-text_display");

    this.keys = trial.keys;
    console.log(trial);
    this.instruction =
      trial.instruction ?? `Press ${this.keys.left} or ${this.keys.right} to start`;

    const results: {
      sentence: string;
      events: Array<Response>;
    } = {
      sentence: trial.sentence.map((x) => x[0]).join(" "),
      events: [],
    };

    const word_on_the_left = Array.from(
      { length: trial.sentence.length },
      (_value, _index) => Math.random() < 0.5
    );

    const listen_input = (callback: (response_is_left: boolean) => void) => {
      const cancelers: Array<() => void> = [];
      const next = (input_type: string, response_is_left: boolean) => {
        for (const handle of cancelers) {
          handle();
        }
        callback(response_is_left);
      };

      // NOTE: could do it with native events but this has the benefit of having just one true
      // listener at all time (see implementation of getKeyBoardResponse)
      const keyboard_listener = this.jsPsych.pluginAPI.getKeyboardResponse({
        callback_function: (info: { key: string; rt: number }) => {
          next("keyboard", this.jsPsych.pluginAPI.compareKeys(info.key, this.keys.left));
        },
        valid_responses: [this.keys.left, this.keys.right],
        rt_method: "performance",
        allow_held_key: false,
      });
      cancelers.push(() => this.jsPsych.pluginAPI.cancelKeyboardResponse(keyboard_listener));

      const swipe_listener = listen_to_swipe(
        this.jsPsych.getDisplayContainerElement(),
        (response_is_left) => {
          this.left_display.classList.remove("highlighted");
          this.right_display.classList.remove("highlighted");
          next("touch", response_is_left);
        },
        {
          move_callback: (start_touch: Touch, current_touch: Touch) => {
            if (current_touch.pageX < start_touch.pageX) {
              this.left_display.classList.add("highlighted");
              this.right_display.classList.remove("highlighted");
            } else {
              this.left_display.classList.remove("highlighted");
              this.right_display.classList.add("highlighted");
            }
          },
        }
      );
      cancelers.push(swipe_listener);
    };

    const start_step = (word_number: number) => {
      const [word, foil] = trial.sentence[word_number];
      const [left, right] = word_on_the_left[word_number] ? [word, foil] : [foil, word];
      this.display_words(left, right);
      const last_display_time = performance.now();
      // TODO: I would like to await sleep() here but I haven't figured out how to make jest work
      // with that yet
      this.jsPsych.pluginAPI.setTimeout(
        () =>
          listen_input((response_is_left: boolean) => {
            process_response(performance.now() - last_display_time, word_number, response_is_left);
          }),
        trial.pre_answer_interval
      );
    };

    const process_response = (interval: number, word_number: number, response_is_left: boolean) => {
      const correct = word_on_the_left[word_number] === response_is_left;
      const [word, foil] = trial.sentence[word_number];
      // FIXME: maybe we want to pre-allocate trial_data.events for more reactivity?
      results.events.push({
        correct: correct,
        foil: foil,
        rt: interval,
        side: word_on_the_left[word_number] ? "left" : "right",
        word: word,
      } as Response);
      if (word_number < trial.sentence.length - 1 && (correct || !trial.halt_on_error)) {
        this.clear_display();
        this.jsPsych.pluginAPI.setTimeout(
          () => start_step(word_number + 1),
          trial.inter_word_interval
        );
      } else {
        end_trial();
      }
    };

    const start_trial = () => {
      start_step(0);
    };

    const end_trial = () => {
      this.jsPsych.finishTrial(results);
    };

    const setup = () => {
      this.display_message(this.instruction);
      listen_input((_) => start_trial());
    };

    setup();
  }

  clear_display() {
    this.center_display.innerHTML = "";
    this.left_display.innerHTML = "";
    this.right_display.innerHTML = "";
    this.text_display.innerHTML = "";
  }

  display_words(left_word: string, right_word: string, text: string | null = null) {
    this.clear_display();

    this.left_display.innerHTML = left_word;
    this.right_display.innerHTML = right_word;

    if (null !== text) {
      this.text_display.innerHTML = text;
    }
  }

  display_message(message: string) {
    this.clear_display();
    this.center_display.innerHTML = message;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listen_to_swipe(
  element: HTMLElement,
  callback: (response_is_left: boolean) => void,
  options: {
    touch_callback?: (touch: Touch) => void;
    move_callback?: (start_touch: Touch, current_touch: Touch) => void;
    min_distance?: number;
  } = {}
) {
  const min_distance = options.min_distance ?? 0;
  const touch_controller = new AbortController();
  const ongoingTouches = new Map<number, Touch>();
  element.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        ongoingTouches.set(touch.identifier, touch);
        if (options.touch_callback) {
          options.touch_callback(touch);
        }
      }
    },
    { signal: touch_controller.signal }
  );

  element.addEventListener(
    "touchmove",
    (e) => {
      // We still need to suppress even if there's no callback
      e.preventDefault();
      if (options.move_callback) {
        for (const current_touch of e.changedTouches) {
          const start_touch = ongoingTouches.get(current_touch.identifier);
          options.move_callback(start_touch, current_touch);
        }
      }
    },
    { signal: touch_controller.signal }
  );

  element.addEventListener(
    "touchcancel",
    (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        ongoingTouches.delete(touch.identifier);
      }
    },
    { signal: touch_controller.signal }
  );

  element.addEventListener(
    "touchend",
    (e) => {
      e.preventDefault();
      for (const end_touch of e.changedTouches) {
        const start_touch = ongoingTouches.get(end_touch.identifier);
        if (end_touch.pageX < start_touch.pageX - min_distance) {
          callback(true);
        } else if (end_touch.pageX > start_touch.pageX + min_distance) {
          callback(false);
        }
      }
    },
    { signal: touch_controller.signal }
  );
  return () => touch_controller.abort();
}

export default MazePlugin;
