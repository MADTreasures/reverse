# MAD Engine – native audio engine for MAD Studio (JUCE, AGPLv3).
#
#   cmake -S engine -B engine/build/Release -G Ninja -DCMAKE_BUILD_TYPE=Release
#   cmake --build engine/build/Release -j4
#
# See README.md for options (local JUCE checkout, test plugins, universal macOS builds).

cmake_minimum_required(VERSION 3.22)

# Must be set before project() so the compiler checks use it.
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Minimum macOS version")

project(MadEngine VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE Release CACHE STRING "Build type" FORCE)
endif()

option(MAD_BUILD_TEST_PLUGINS "Build the 'MAD Test Gain', 'MAD Test Synth' and 'MAD Test Delay' plugins used by the tests" OFF)
option(MAD_ENABLE_LV2 "Host LV2 plugins on Linux" ON)
option(MAD_ENABLE_JACK "Enable the JACK audio backend on Linux when its headers are available" ON)
option(MAD_ENABLE_ASIO "ASIO audio devices on Windows (ASIO SDK headers bundled with JUCE, used under GPLv3)" ON)

# ---------------------------------------------------------------------------------------------
# JUCE 8 (latest 8.x release). Either a local checkout (-DMAD_JUCE_DIR=...) or the release tarball.

set(MAD_JUCE_VERSION "8.0.15")
set(MAD_JUCE_DIR "" CACHE PATH "Path to a local JUCE ${MAD_JUCE_VERSION} checkout (skips the download)")
set(MAD_JUCE_URL "https://github.com/juce-framework/JUCE/archive/refs/tags/${MAD_JUCE_VERSION}.tar.gz"
    CACHE STRING "JUCE release tarball")
set(MAD_JUCE_SHA256 "0eafd736286c6e7bb6958d79fce18d42cb654b8e231890d327b7cece379bd156"
    CACHE STRING "SHA256 of the JUCE release tarball")

if(MAD_JUCE_DIR)
    if(NOT EXISTS "${MAD_JUCE_DIR}/CMakeLists.txt")
        message(FATAL_ERROR "MAD_JUCE_DIR='${MAD_JUCE_DIR}' does not contain a JUCE checkout")
    endif()
    add_subdirectory("${MAD_JUCE_DIR}" "${CMAKE_BINARY_DIR}/juce" EXCLUDE_FROM_ALL)
else()
    include(FetchContent)
    FetchContent_Declare(juce
        URL "${MAD_JUCE_URL}"
        URL_HASH "SHA256=${MAD_JUCE_SHA256}"
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    # JUCE only adds interface libraries (plus juceaide, built at configure time) by default.
    FetchContent_MakeAvailable(juce)
endif()

# ---------------------------------------------------------------------------------------------
# The engine executable. macOS: "MAD Engine.app" (agent app without Dock icon); elsewhere: mad-engine.

if(APPLE)
    set(MAD_ENGINE_PRODUCT "MAD Engine")
    set(MAD_PLUGINHOST_AU TRUE)
else()
    set(MAD_ENGINE_PRODUCT "mad-engine")
    set(MAD_PLUGINHOST_AU FALSE)
endif()

juce_add_gui_app(MadEngine
    PRODUCT_NAME "${MAD_ENGINE_PRODUCT}"
    VERSION "${PROJECT_VERSION}"
    COMPANY_NAME "MADTreasures"
    COMPANY_COPYRIGHT "Copyright (c) 2026 MADTreasures"
    BUNDLE_ID "io.github.madtreasures.madstudio.engine"
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT "MAD Studio records audio from your microphone or audio interface."
    PLIST_TO_MERGE "<plist><dict><key>LSUIElement</key><true/></dict></plist>"
    PLUGINHOST_AU ${MAD_PLUGINHOST_AU}
    NEEDS_CURL FALSE
    NEEDS_WEB_BROWSER FALSE)

# Put the product directly into the build directory: build/<config>/mad-engine(.exe) or "MAD Engine.app".
# The generator expression keeps multi-config generators (Visual Studio) from adding a <config> folder.
set_target_properties(MadEngine PROPERTIES RUNTIME_OUTPUT_DIRECTORY "$<1:${CMAKE_BINARY_DIR}>")

if(WIN32)
    # The engine talks over stdin/stdout, so it is a console program with a plain main().
    # _CONSOLE selects JUCE's argc/argv entry point (as juce_add_console_app does).
    set_target_properties(MadEngine PROPERTIES WIN32_EXECUTABLE FALSE)
    target_compile_definitions(MadEngine PRIVATE _CONSOLE=1)
endif()

target_sources(MadEngine PRIVATE
    src/app/Main.cpp
    src/app/Controller.cpp
    src/app/Controller.h
    src/app/CommandLine.cpp
    src/app/CommandLine.h
    src/core/Cadence.cpp
    src/core/Cadence.h
    src/core/Json.cpp
    src/core/Json.h
    src/core/Protocol.cpp
    src/core/Protocol.h
    src/core/Realtime.h
    src/core/Log.h
    src/dsp/Biquad.cpp
    src/dsp/Biquad.h
    src/dsp/Compressor.cpp
    src/dsp/Compressor.h
    src/dsp/DelayLine.h
    src/dsp/Envelope.cpp
    src/dsp/Envelope.h
    src/dsp/ImpulseResponse.cpp
    src/dsp/ImpulseResponse.h
    src/dsp/Oscillator.cpp
    src/dsp/Oscillator.h
    src/dsp/Panner.h
    src/dsp/Smoother.h
    src/dsp/WaveShaper.cpp
    src/dsp/WaveShaper.h
    src/engine/AudioEngine.cpp
    src/engine/AudioEngine.h
    src/engine/Effects.cpp
    src/engine/Effects.h
    src/engine/Graph.cpp
    src/engine/Graph.h
    src/engine/GraphBuilder.cpp
    src/engine/GraphBuilder.h
    src/engine/Instruments.cpp
    src/engine/Instruments.h
    src/engine/Latency.cpp
    src/engine/Latency.h
    src/engine/Params.cpp
    src/engine/Params.h
    src/engine/ProjectModel.cpp
    src/engine/ProjectModel.h
    src/engine/Recorder.cpp
    src/engine/Recorder.h
    src/engine/Renderer.cpp
    src/engine/Renderer.h
    src/engine/Samples.cpp
    src/engine/Samples.h
    src/engine/Sequencer.cpp
    src/engine/Sequencer.h
    src/engine/Timeline.cpp
    src/engine/Timeline.h
    src/engine/Wav.cpp
    src/engine/Wav.h
    src/io/DeviceManager.cpp
    src/io/DeviceManager.h
    src/io/NullDevice.cpp
    src/io/NullDevice.h
    src/plugins/PluginHost.cpp
    src/plugins/PluginHost.h
    src/plugins/PluginScan.cpp
    src/plugins/PluginScan.h
    src/plugins/PluginSlot.cpp
    src/plugins/PluginSlot.h
    src/tests/ReferenceData.h
    src/tests/SelfTest.cpp
    src/tests/SelfTest.h)

target_include_directories(MadEngine PRIVATE src)

set(MAD_PLATFORM_DEFS)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    if(MAD_ENABLE_LV2)
        list(APPEND MAD_PLATFORM_DEFS JUCE_PLUGINHOST_LV2=1)
    endif()
    if(MAD_ENABLE_JACK)
        include(CheckIncludeFileCXX)
        check_include_file_cxx("jack/jack.h" MAD_HAVE_JACK_HEADERS)
        if(MAD_HAVE_JACK_HEADERS)
            # JUCE loads libjack at runtime, so this adds no link dependency.
            list(APPEND MAD_PLATFORM_DEFS JUCE_JACK=1)
        endif()
    endif()
elseif(WIN32 AND MAD_ENABLE_ASIO)
    # JUCE ships Steinberg's ASIO SDK 2.3.4 headers, dual-licensed (proprietary or GPLv3); the
    # engine uses them under GPLv3 (licence texts in licenses/).
    list(APPEND MAD_PLATFORM_DEFS JUCE_ASIO=1)
endif()

target_compile_definitions(MadEngine PRIVATE
    MAD_ENGINE_VERSION="${PROJECT_VERSION}"
    MAD_JUCE_VERSION_STRING="${MAD_JUCE_VERSION}"
    JUCE_APPLICATION_NAME_STRING="$<TARGET_PROPERTY:MadEngine,JUCE_PRODUCT_NAME>"
    JUCE_APPLICATION_VERSION_STRING="$<TARGET_PROPERTY:MadEngine,JUCE_VERSION>"
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_USE_MP3AUDIOFORMAT=0
    JUCE_PLUGINHOST_VST3=1
    JUCE_STRICT_REFCOUNTEDPOINTER=1
    JUCE_SILENCE_XCODE_15_LINKER_WARNING=1
    ${MAD_PLATFORM_DEFS})

target_link_libraries(MadEngine
    PRIVATE
        juce::juce_core
        juce::juce_events
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_processors
        juce::juce_dsp
        juce::juce_gui_basics
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)

# ---------------------------------------------------------------------------------------------

if(MAD_BUILD_TEST_PLUGINS)
    add_subdirectory(test-plugins)
endif()

message(STATUS "MAD Engine ${PROJECT_VERSION}: JUCE ${MAD_JUCE_VERSION}, product '${MAD_ENGINE_PRODUCT}' in ${CMAKE_BINARY_DIR}")
