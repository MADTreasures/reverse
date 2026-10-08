# Test plugins for the protocol test (built with -DMAD_BUILD_TEST_PLUGINS=ON).
# After building they are copied to <build>/plugins/:
#   "MAD Test Gain.vst3"  effect, one parameter `gain` (0..1, default 0.5), out = in * gain
#   "MAD Test Synth.vst3" instrument, sine per MIDI note, amplitude velocity * 0.25, 5 ms attack/release
#   "MAD Test Delay.vst3" effect, delays by `latency` samples (0..9600, default 1000) and reports it
# On macOS also as AudioUnits ("*.component", same folder; not registered with the system).

set(MAD_TEST_PLUGIN_DIR "${CMAKE_BINARY_DIR}/plugins")
set(MAD_TEST_PLUGIN_FORMATS VST3)
if(APPLE)
    list(APPEND MAD_TEST_PLUGIN_FORMATS AU)
endif()

function(mad_add_test_plugin target product code kind)
    set(is_synth FALSE)
    if(kind STREQUAL "synth")
        set(is_synth TRUE)
    endif()
    if(is_synth)
        set(categories Instrument Synth)
        set(au_type kAudioUnitType_MusicDevice)
    else()
        set(categories Fx)
        set(au_type kAudioUnitType_Effect)
    endif()

    juce_add_plugin(${target}
        PRODUCT_NAME "${product}"
        PLUGIN_NAME "${product}"
        COMPANY_NAME "MAD"
        BUNDLE_ID "io.github.madtreasures.madstudio.${target}"
        VERSION "${PROJECT_VERSION}"
        PLUGIN_MANUFACTURER_CODE Madt
        PLUGIN_CODE ${code}
        FORMATS ${MAD_TEST_PLUGIN_FORMATS}
        IS_SYNTH ${is_synth}
        NEEDS_MIDI_INPUT ${is_synth}
        NEEDS_MIDI_OUTPUT FALSE
        IS_MIDI_EFFECT FALSE
        EDITOR_WANTS_KEYBOARD_FOCUS FALSE
        VST3_CATEGORIES ${categories}
        AU_MAIN_TYPE ${au_type}
        COPY_PLUGIN_AFTER_BUILD TRUE
        VST3_COPY_DIR "${MAD_TEST_PLUGIN_DIR}"
        AU_COPY_DIR "${MAD_TEST_PLUGIN_DIR}")

    target_sources(${target} PRIVATE TestPlugins.cpp)
    target_compile_definitions(${target}
        PUBLIC
            JUCE_WEB_BROWSER=0
            JUCE_USE_CURL=0
            JUCE_VST3_CAN_REPLACE_VST2=0
            MAD_TEST_SYNTH=$<IF:$<BOOL:${is_synth}>,1,0>
            MAD_TEST_DELAY=$<IF:$<STREQUAL:${kind},delay>,1,0>)
    target_link_libraries(${target}
        PRIVATE
            juce::juce_audio_processors
        PUBLIC
            juce::juce_recommended_config_flags
            juce::juce_recommended_warning_flags)
endfunction()

mad_add_test_plugin(MadTestGain "MAD Test Gain" Mtgn gain)
mad_add_test_plugin(MadTestSynth "MAD Test Synth" Mtsy synth)
mad_add_test_plugin(MadTestDelay "MAD Test Delay" Mtdl delay)
